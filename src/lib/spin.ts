import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { cardCopyCache, cards } from "@/db/schema";
import {
  CardSchema,
  PlaceSchema,
  type Card,
  type Filters,
  type Place,
  type SpinRequest,
  type SpinResponse,
} from "@/lib/schemas";
import { geocodeOrigin } from "@/lib/geocode";
import { isExpired, localDateISO } from "@/lib/local-date";
// Pinned in CONTRACT.md, owned by the data-pipeline track. The station-matrix
// module doesn't exist yet in this worktree; see spin.test.ts, which mocks
// it so tests run standalone. tsc --noEmit will fail to resolve this import
// until that track's branch is merged; that's expected (see final report).
//
// Note on how this is imported: a relative path here, not the @ alias.
// Vite's alias resolver needs the target file to exist on disk before a
// mock can intercept it; a plain relative specifier can be mocked even when
// nothing resolves there yet (verified empirically). Safe to switch back to
// the @ alias once the real file lands, if preferred for consistency. Also
// avoid writing this module's relative import path as a quoted string
// anywhere else in this file, including inside comments — Vite's import
// scanner appears to pick that up as a second occurrence of the same
// specifier and fails resolution, even inside a `//` comment.
import { loadStationMatrix, nearestStation, travelBetween } from "./station-matrix";
// Pinned in CONTRACT.md, owned by the filters-collection track. Same
// situation as the station-matrix module above (doesn't exist yet, mocked
// in tests, imported via relative path for the same reason).
import { buildPlaceQuery } from "./query-builder";
// Pinned in CONTRACT.md, owned by the rarity-engine track. Same situation.
import { rollCard } from "./rarity";

/**
 * A place augmented with the per-spin, origin-dependent travel info that
 * rollCard's rarity scoring needs (score = f(travelMinutes, tagCount,
 * touristDistanceM) per CONTRACT.md). `Place` (schemas.ts) intentionally has
 * no travelMinutes/viaLine field — travel time depends on the rider's
 * geocoded origin at spin time, not a static place attribute, so it can't
 * live on the ingested Place record.
 *
 * This type is structurally assignable to `Place[]` (it has every required
 * Place field plus extras), so it satisfies rollCard's pinned
 * `rollCard(pool: Place[], ...)` signature without changing that signature.
 * We do NOT rely on rarity.ts reading `.travelMinutes` off the objects it's
 * handed, though — see `withTravel` / the id-keyed lookup below — because
 * rarity.ts's own declared parameter types (`Place`) don't expose those
 * extra fields, so nothing upstream guarantees they survive the round trip.
 * Flagged in the final report as a contract gap worth closing (e.g. an
 * optional `travelMinutes`/`viaLine` on Place, or a richer rollCard input).
 */
export interface PlaceWithTravel extends Place {
  travelMinutes: number;
  viaLine: string;
}

/**
 * Row shape as it actually comes back from executing buildPlaceQuery's
 * output. Both members of its pinned union type (`{ sql, params }` and a
 * drizzle `sql`-tagged-template SQL object) represent raw SQL text rather
 * than drizzle's typed `db.select().from(places)` query builder — only that
 * typed builder applies the schema's snake_case -> camelCase column
 * mapping. Raw SQL execution (via `db.$client.prepare(...).all()` or
 * `db.all(sqlObject)`) returns rows keyed by the literal SQLite column
 * names, and boolean-mode columns (`indoor`, `step_free_ok`) come back as
 * 0/1 integers rather than real booleans. Flagged for the integration pass
 * to confirm against the real query-builder.ts once it lands — if it
 * aliases columns to camelCase in its SELECT list instead, this needs to
 * change accordingly.
 */
const PlaceRowSchema = z.object({
  id: z.string(),
  osm_id: z.string(),
  osm_type: z.enum(["node", "way", "relation"]),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  borough: PlaceSchema.shape.borough,
  category: PlaceSchema.shape.category,
  tags_json: z.string(),
  tag_count: z.number(),
  address: z.string().nullable(),
  opening_hours_raw: z.string().nullable(),
  budget_tier: PlaceSchema.shape.budgetTier,
  indoor: z.union([z.number(), z.boolean()]),
  nearest_station_id: z.string(),
  walk_minutes_to_station: z.number(),
  step_free_ok: z.union([z.number(), z.boolean()]),
  tourist_distance_m: z.number(),
  quality_score: z.number(),
});

function rowToPlace(row: unknown): Place {
  const r = PlaceRowSchema.parse(row);
  return PlaceSchema.parse({
    id: r.id,
    osmId: r.osm_id,
    osmType: r.osm_type,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    borough: r.borough,
    category: r.category,
    tags: JSON.parse(r.tags_json) as Record<string, string>,
    tagCount: r.tag_count,
    address: r.address,
    openingHoursRaw: r.opening_hours_raw,
    budgetTier: r.budget_tier,
    indoor: Boolean(r.indoor),
    nearestStationId: r.nearest_station_id,
    walkMinutesToStation: r.walk_minutes_to_station,
    stepFreeOk: Boolean(r.step_free_ok),
    touristDistanceM: r.tourist_distance_m,
    qualityScore: r.quality_score,
  });
}

type BuiltQuery = ReturnType<typeof buildPlaceQuery>;

function isRawQuery(q: BuiltQuery): q is { sql: string; params: unknown[] } {
  return (
    typeof q === "object" &&
    q !== null &&
    typeof (q as { sql?: unknown }).sql === "string" &&
    Array.isArray((q as { params?: unknown }).params)
  );
}

/**
 * Runs buildPlaceQuery(filters) against the real db and decodes the rows
 * into Place objects. buildPlaceQuery's pinned return type is a union
 * (raw {sql, params} vs. a drizzle `sql` tagged-template SQL object) so we
 * branch on shape rather than assume one form.
 */
function fetchCandidatePlaces(filters: Filters): Place[] {
  const built = buildPlaceQuery(filters);
  const rows: unknown[] = isRawQuery(built)
    ? db.$client.prepare(built.sql).all(...built.params)
    : (db.all(built) as unknown[]);
  return rows.map(rowToPlace);
}

/** Fallback copy used when a place has no cached card copy yet — never blocks a spin. */
function fallbackCopy(place: Place): { name: string; reason: string; dare: string; timeWindow: Card["timeWindow"] } {
  return {
    name: place.name,
    reason: "A quiet stop most people never route through.",
    dare: "Spend five minutes here before you head back.",
    timeWindow: "any",
  };
}

function lookupCopy(placeId: string): { name: string; reason: string; dare: string; timeWindow: Card["timeWindow"] } | null {
  const row = db.select().from(cardCopyCache).where(eq(cardCopyCache.placeId, placeId)).get();
  if (!row) return null;
  return {
    name: row.name,
    reason: row.reason,
    dare: row.dare,
    timeWindow: row.timeWindow as Card["timeWindow"],
  };
}

function rowToCard(row: typeof cards.$inferSelect): Card {
  return {
    id: row.id,
    userId: row.userId,
    dealtDate: row.dealtDate,
    timezone: row.timezone,
    placeId: row.placeId,
    rarityTier: row.rarityTier as Card["rarityTier"],
    score: row.score,
    travelMinutes: row.travelMinutes,
    viaLine: row.viaLine,
    name: row.name,
    reason: row.reason,
    dare: row.dare,
    timeWindow: row.timeWindow as Card["timeWindow"],
    status: row.status as Card["status"],
    proofType: row.proofType as Card["proofType"],
    photoPath: row.photoPath,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    originLabel: row.originLabel,
    originLat: row.originLat,
    originLon: row.originLon,
  };
}

/**
 * "Expired" is computed lazily on read, never cron'd or written back
 * (per CONTRACT.md's Daily lock section) — a card's persisted `status`
 * stays "locked" until a proof completes it; this function is the single
 * place that layers "expired" on top for anything we hand back to a
 * caller, so every read path (the already_dealt branch, the GET route's
 * today's-card lookup, and a freshly inserted card in the rare case a spin
 * completes right at midnight) agrees on the same answer.
 *
 * Exported (with an optional `at` override) so it's directly unit-testable
 * without fighting the clock, and so other tracks (e.g. the collection grid,
 * which renders past cards that legitimately CAN be expired — unlike
 * `getTodaysCard`, which by construction can never return an expired card
 * since "today's dealtDate" and "local midnight hasn't passed for today's
 * dealtDate" are the same fact) can reuse the same status logic instead of
 * reimplementing it.
 */
export function withComputedStatus(card: Card, at: Date = new Date()): Card {
  if (card.status === "locked" && isExpired(card.dealtDate, card.timezone, at)) {
    return { ...card, status: "expired" };
  }
  return card;
}

function findCard(userId: string, dealtDate: string): Card | null {
  const row = db
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.dealtDate, dealtDate)))
    .get();
  return row ? rowToCard(row) : null;
}

/**
 * Returns today's already-dealt card for (userId, timezone), or null if the
 * user hasn't spun yet today. Pure read, no side effects, no roll logic —
 * this is what GET /api/spin uses so the frontend can decide "show a spin
 * button" vs. "show today's locked card" on page load without spinning.
 */
export function getTodaysCard(userId: string, timezone: string): Card | null {
  const dealtDate = localDateISO(timezone);
  const card = findCard(userId, dealtDate);
  return card ? withComputedStatus(card) : null;
}

/**
 * Design note — "re-fetching today's already-dealt card":
 *
 * SpinResponseSchema's success branch (`{ ok: true, card, poolSize }`) is
 * shaped for a *new* roll (it always carries poolSize). Re-serving an
 * existing card is therefore NOT routed through the ok:true branch — it
 * goes through `{ ok: false, error: "already_dealt", message, existingCard }`,
 * which the schema already has a slot for. This keeps "a spin happened
 * just now" (ok:true) and "you already have a card for today" (ok:false /
 * already_dealt) visibly distinct to callers, while still handing back the
 * full locked Card either way — `ok: false` here is not a failure the UI
 * needs to apologize for, it's just "no new roll occurred."
 *
 * Reading today's card WITHOUT attempting a spin (e.g. on page load) goes
 * through `getTodaysCard` / the GET handler instead, which never touches
 * geocoding, the station matrix, or rollCard at all. Two entry points, one
 * row: `spin()` only ever inserts once per (userId, dealtDate) — the
 * uniqueness constraint in the schema and the check-then-insert-with-
 * fallback-refetch below make "no reroll, ever" hold even under a
 * concurrent double-submit (two in-flight POSTs for the same user/day: the
 * loser's INSERT hits the unique constraint, catches it, and re-reads the
 * winner's row instead of erroring).
 */
export async function spin(request: SpinRequest): Promise<SpinResponse> {
  const dealtDate = localDateISO(request.timezone);

  const existing = findCard(request.userId, dealtDate);
  if (existing) {
    return {
      ok: false,
      error: "already_dealt",
      message: "You already have a card for today.",
      existingCard: withComputedStatus(existing),
    };
  }

  const geocoded = await geocodeOrigin(request.origin);
  if (!geocoded) {
    return {
      ok: false,
      error: "geocode_failed",
      message: "Couldn't find that address or ZIP near NYC. Try being more specific.",
    };
  }

  loadStationMatrix();
  const originStation = nearestStation(geocoded.lat, geocoded.lon);
  if (!originStation) {
    // No subway station could be resolved near the geocoded point (e.g. the
    // origin, while inside our NYC geocoding viewbox, is too far from
    // transit to snap to a station). This is fundamentally still an
    // "we couldn't place your origin usefully" problem, so it surfaces
    // through the same error as a geocoding miss rather than adding a new
    // error case outside SpinResponseSchema's pinned enum.
    return {
      ok: false,
      error: "geocode_failed",
      message: "That location isn't near any subway station we cover.",
    };
  }

  let candidates: Place[];
  try {
    candidates = fetchCandidatePlaces(request.filters);
  } catch {
    return {
      ok: false,
      error: "invalid_filters",
      message: "Those filters couldn't be applied. Try loosening them.",
    };
  }

  // maxTravelMinutes is origin-dependent (it's a function of the rider's
  // specific geocoded start point, not a static place attribute), so unlike
  // every other Filters field it cannot be pushed into buildPlaceQuery's
  // SQL (that function only receives `filters`, never the origin station).
  // We apply it here, against each place's travel time from the user's
  // nearest station, as the one deliberate exception to "no post-query
  // array filtering."
  const pool: PlaceWithTravel[] = [];
  for (const place of candidates) {
    const travel = travelBetween(originStation.station.id, place.nearestStationId);
    if (!travel) continue; // unreachable by subway from this origin
    const travelMinutes = travel.minutes + originStation.walkMinutes + place.walkMinutesToStation;
    if (request.filters.maxTravelMinutes !== "any" && travelMinutes > request.filters.maxTravelMinutes) {
      continue;
    }
    pool.push({ ...place, travelMinutes, viaLine: travel.viaLine });
  }

  const poolSize = pool.length;
  if (poolSize === 0) {
    return {
      ok: false,
      error: "pool_too_small",
      message: "No reachable places match your filters today. Try loosening them.",
    };
  }

  // Re-derive travel info by id after rollCard returns rather than trusting
  // that the returned `RollResult.place` still carries the extra
  // travelMinutes/viaLine properties we attached above — see the
  // PlaceWithTravel doc comment for why that's not guaranteed by rarity.ts's
  // declared types.
  const travelById = new Map(pool.map((p) => [p.id, { travelMinutes: p.travelMinutes, viaLine: p.viaLine }]));

  const result = rollCard(pool, request.userId, dealtDate);
  const travel = travelById.get(result.place.id);
  if (!travel) {
    // Should be unreachable: rollCard is contracted to pick from `pool`.
    throw new Error(`rollCard returned a place (${result.place.id}) not present in the pool it was given`);
  }

  const copy = lookupCopy(result.place.id) ?? fallbackCopy(result.place);

  const card: Card = CardSchema.parse({
    id: randomUUID(),
    userId: request.userId,
    dealtDate,
    timezone: request.timezone,
    placeId: result.place.id,
    rarityTier: result.tier,
    score: result.score,
    travelMinutes: travel.travelMinutes,
    viaLine: travel.viaLine,
    name: copy.name,
    reason: copy.reason,
    dare: copy.dare,
    timeWindow: copy.timeWindow,
    status: "locked",
    proofType: null,
    photoPath: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    originLabel: geocoded.label,
    originLat: geocoded.lat,
    originLon: geocoded.lon,
  });

  try {
    db.insert(cards).values(card).run();
  } catch (err) {
    // Concurrent double-submit for the same (userId, dealtDate): the loser
    // hits the unique constraint. Re-read instead of failing — this is the
    // "no reroll, ever" invariant's last line of defense.
    const raced = findCard(request.userId, dealtDate);
    if (raced) {
      return {
        ok: false,
        error: "already_dealt",
        message: "You already have a card for today.",
        existingCard: withComputedStatus(raced),
      };
    }
    throw err;
  }

  return { ok: true, card, poolSize };
}
