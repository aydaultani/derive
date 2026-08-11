import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
import { buildPlaceQuery, filterOpenNow, type PlaceQueryRow } from "./query-builder";
// Pinned in CONTRACT.md, owned by the rarity-engine track. Same situation.
import { rollCard, type ScoredPlaceInput } from "./rarity";

/**
 * `ScoredPlaceInput` (from rarity.ts) is `Place & { travelMinutes: number }`
 * — travel time is computed per-spin from the rider's geocoded origin, not a
 * static place attribute, so it can't live on the ingested `Place` record.
 * We build this array by joining each candidate's `travelBetween()` result
 * onto it below, right before calling `rollCard`.
 */

/** query-builder.ts's `buildPlaceQuery` returns a real, awaitable Drizzle
 * query (not raw SQL text) already mapped to camelCase columns — see
 * `PlaceQueryRow`. `qualityScore`/`osmType` etc. round-trip untouched;
 * only `tagsJson` needs decoding back into `Place.tags`. */
function rowToPlace(row: PlaceQueryRow): Place {
  return PlaceSchema.parse({
    id: row.id,
    osmId: row.osmId,
    osmType: row.osmType,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    borough: row.borough,
    category: row.category,
    tags: JSON.parse(row.tagsJson) as Record<string, string>,
    tagCount: row.tagCount,
    address: row.address,
    openingHoursRaw: row.openingHoursRaw,
    budgetTier: row.budgetTier,
    indoor: row.indoor,
    nearestStationId: row.nearestStationId,
    walkMinutesToStation: row.walkMinutesToStation,
    stepFreeOk: row.stepFreeOk,
    touristDistanceM: row.touristDistanceM,
    qualityScore: row.qualityScore,
  });
}

/** Runs buildPlaceQuery(filters) against the real db, applies the openNow
 * two-step (see query-builder.ts), and decodes rows into Place objects. */
async function fetchCandidatePlaces(filters: Filters): Promise<Place[]> {
  const rows = await buildPlaceQuery(filters);
  const finalRows = filterOpenNow(rows, filters.openNow);
  return finalRows.map(rowToPlace);
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
    transfers: row.transfers,
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
    placeLat: row.placeLat,
    placeLon: row.placeLon,
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
    candidates = await fetchCandidatePlaces(request.filters);
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
  //
  // `rollCard` (rarity.ts) only accepts `ScoredPlaceInput = Place & { travelMinutes }`
  // — no viaLine/transfers — so those extras are tracked in a side map keyed
  // by place id instead of appended onto the objects handed to rollCard.
  const pool: ScoredPlaceInput[] = [];
  const travelById = new Map<string, { travelMinutes: number; transfers: number; viaLine: string }>();
  for (const place of candidates) {
    const travel = travelBetween(originStation.station.id, place.nearestStationId);
    if (!travel) continue; // unreachable by subway from this origin
    const travelMinutes = travel.minutes + originStation.walkMinutes + place.walkMinutesToStation;
    if (request.filters.maxTravelMinutes !== "any" && travelMinutes > request.filters.maxTravelMinutes) {
      continue;
    }
    pool.push({ ...place, travelMinutes });
    travelById.set(place.id, { travelMinutes, transfers: travel.transfers, viaLine: travel.viaLine });
  }

  const poolSize = pool.length;
  if (poolSize === 0) {
    return {
      ok: false,
      error: "pool_too_small",
      message: "No reachable places match your filters today. Try loosening them.",
    };
  }

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
    transfers: travel.transfers,
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
    placeLat: result.place.lat,
    placeLon: result.place.lon,
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
