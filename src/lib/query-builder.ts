import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import OpeningHours from "opening_hours";
import { db } from "@/db/client";
import { cardCopyCache, places, stations } from "@/db/schema";
import type { Filters } from "@/lib/schemas";

/**
 * Every `Filters` field that CAN be expressed as a SQL predicate against
 * `places` (joined to `stations` and `card_copy_cache`) is expressed here —
 * never as a post-query `.filter()` over already-fetched rows. Two fields
 * are documented exceptions, applied by the caller instead:
 *
 * - `rarityFloor` — rarity is a *score computed relative to the current
 *   pool* (see src/lib/rarity.ts), not a stored column. It can't be known
 *   until the pool this function returns has already been scored. The spin
 *   orchestration applies `rarityFloor` AFTER calling `buildPlaceQuery` and
 *   scoring the result with `scorePlace`/`rollCard`.
 * - `maxTravelMinutes` — travel time depends on the rider's specific origin
 *   station (looked up via `nearestStation()` + `travelBetween()` in
 *   src/lib/station-matrix.ts at spin time). This function has no origin to
 *   join against, so the caller filters the returned pool by travel time
 *   after computing per-place minutes from the snapped origin station.
 *
 * `openNow` is a documented two-step exception (allowed by CONTRACT.md):
 * this function only narrows to rows with a non-null `openingHoursRaw`
 * (skip "hours unknown" places when the toggle is on, per the product
 * spec's honest-unknown-state requirement). Precise evaluation against the
 * `opening_hours` grammar happens in JS, via `filterOpenNow()` below, run
 * by the caller against the narrowed rows.
 */
export function buildPlaceQuery(filters: Filters) {
  const conditions: SQL[] = [];

  if (filters.boroughs.length > 0) {
    conditions.push(inArray(places.borough, filters.boroughs));
  }

  if (filters.categories.length > 0) {
    conditions.push(inArray(places.category, filters.categories));
  }

  // "under_15" subsumes "free" — free places are, definitionally, under $15.
  if (filters.budget === "free") {
    conditions.push(eq(places.budgetTier, "free"));
  } else if (filters.budget === "under_15") {
    conditions.push(inArray(places.budgetTier, ["free", "under_15"]));
  }

  if (filters.indoorOnly) {
    conditions.push(eq(places.indoor, true));
  }

  if (filters.stepFreeOnly) {
    conditions.push(eq(stations.ada, true));
  }

  if (filters.openNow) {
    conditions.push(isNotNull(places.openingHoursRaw));
  }

  if (filters.timeOfDay !== "any") {
    conditions.push(inArray(cardCopyCache.timeWindow, [filters.timeOfDay, "any"]));
  }

  const query = db
    .select({
      id: places.id,
      osmId: places.osmId,
      osmType: places.osmType,
      name: places.name,
      lat: places.lat,
      lon: places.lon,
      borough: places.borough,
      category: places.category,
      tagsJson: places.tagsJson,
      tagCount: places.tagCount,
      address: places.address,
      openingHoursRaw: places.openingHoursRaw,
      budgetTier: places.budgetTier,
      indoor: places.indoor,
      nearestStationId: places.nearestStationId,
      walkMinutesToStation: places.walkMinutesToStation,
      stepFreeOk: places.stepFreeOk,
      touristDistanceM: places.touristDistanceM,
      qualityScore: places.qualityScore,
      sourceUpdatedAt: places.sourceUpdatedAt,
    })
    .from(places)
    .leftJoin(stations, eq(places.nearestStationId, stations.id))
    .leftJoin(cardCopyCache, eq(places.id, cardCopyCache.placeId))
    .$dynamic();

  return conditions.length > 0 ? query.where(and(...conditions)) : query;
}

/** Row shape returned by `buildPlaceQuery` (a subset of `Place` — station-matrix
 * and rarity fields aren't stored on `places` and are joined in later by the
 * spin orchestration / station matrix, not here). */
export type PlaceQueryRow = Awaited<ReturnType<typeof buildPlaceQuery>>[number];

/**
 * Step 2 of the `openNow` filter: precise per-row evaluation using the
 * `opening_hours` grammar, run against rows already SQL-narrowed by
 * `buildPlaceQuery` (which only guarantees `openingHoursRaw IS NOT NULL`).
 * A row whose `openingHoursRaw` fails to parse is treated as closed rather
 * than thrown away silently — malformed OSM tags shouldn't crash a spin.
 */
export function filterOpenNow<T extends { openingHoursRaw: string | null }>(
  rows: T[],
  openNow: boolean,
  now: Date = new Date(),
): T[] {
  if (!openNow) return rows;
  return rows.filter((row) => {
    if (!row.openingHoursRaw) return false;
    try {
      const oh = new OpeningHours(row.openingHoursRaw);
      return oh.getState(now);
    } catch {
      return false;
    }
  });
}

const SHRINK_POOL_THRESHOLD = 40;

interface ActiveFilterDescriptor {
  label: string;
  /** Rough specificity weight — higher means "more likely the culprit" when
   * we have no per-filter pool counts to compare against (see doc below). */
  weight: number;
}

/**
 * Heuristic, synchronous "which filter is hurting me" message for the UI.
 * Only given the final pool size and the size with NO filters applied, this
 * cannot know the true marginal contribution of each individual filter
 * (that requires re-running the query with each filter relaxed one at a
 * time — see `findShrinkingFilterCulprit` below for that exact, DB-backed
 * version, used by `src/app/api/places/route.ts`). This function is the
 * lightweight fallback: it ranks currently-active filters by how
 * restrictive they *look* (fewer selected boroughs/categories, tighter
 * budget/time-of-day, etc.) and names the most suspicious one. Never a hard
 * error — always a warning string or null.
 */
export function describeShrinkingFilter(
  filters: Filters,
  poolSize: number,
  unfilteredPoolSize: number,
): string | null {
  if (poolSize >= SHRINK_POOL_THRESHOLD || poolSize >= unfilteredPoolSize) return null;

  const active: ActiveFilterDescriptor[] = [];
  if (filters.boroughs.length > 0) {
    active.push({ label: "Boroughs", weight: 5 - filters.boroughs.length });
  }
  if (filters.categories.length > 0) {
    active.push({ label: "Categories", weight: 10 - filters.categories.length });
  }
  if (filters.budget === "free") active.push({ label: "Budget (free only)", weight: 4 });
  else if (filters.budget === "under_15") active.push({ label: "Budget (under $15)", weight: 2 });
  if (filters.indoorOnly) active.push({ label: "Indoors only", weight: 1 });
  if (filters.stepFreeOnly) active.push({ label: "Step-free only", weight: 2 });
  if (filters.openNow) active.push({ label: "Open now", weight: 2 });
  if (filters.timeOfDay !== "any") {
    active.push({ label: `Time of day (${filters.timeOfDay})`, weight: 4 });
  }
  if (filters.maxTravelMinutes !== "any") {
    active.push({ label: `Max travel (${filters.maxTravelMinutes} min)`, weight: 1 });
  }
  if (filters.rarityFloor !== "common") {
    active.push({ label: `Rarity floor (${filters.rarityFloor}+)`, weight: 1 });
  }

  if (active.length === 0) {
    return `Your pool is down to ${poolSize} places — that's just what's out there tonight.`;
  }

  active.sort((a, b) => b.weight - a.weight);
  const worst = active[0];

  if (active.length === 1) {
    return `${worst.label} is cutting your pool to ${poolSize} places.`;
  }
  return `${worst.label} looks like the biggest cut — ${active.length} filters together bring you down to ${poolSize} of ${unfilteredPoolSize} places.`;
}

/**
 * DB-backed, exact version of the "which filter is hurting me" question:
 * relax each currently-active filter one at a time, re-run the (origin-
 * independent) pool query, and report whichever single relaxation would
 * grow the pool the most. Slightly more expensive (N+1 queries where N is
 * the number of active filters, N <= 8) but genuinely accurate — used by
 * `src/app/api/places/route.ts` when the live pool is small.
 */
export async function findShrinkingFilterCulprit(
  filters: Filters,
): Promise<{ label: string; poolSizeIfRelaxed: number } | null> {
  type Relaxation = { label: string; relaxed: Filters };
  const relaxations: Relaxation[] = [];

  if (filters.boroughs.length > 0) {
    relaxations.push({ label: "Boroughs", relaxed: { ...filters, boroughs: [] } });
  }
  if (filters.categories.length > 0) {
    relaxations.push({ label: "Categories", relaxed: { ...filters, categories: [] } });
  }
  if (filters.budget !== "any") {
    relaxations.push({ label: "Budget", relaxed: { ...filters, budget: "any" } });
  }
  if (filters.indoorOnly) {
    relaxations.push({ label: "Indoors only", relaxed: { ...filters, indoorOnly: false } });
  }
  if (filters.stepFreeOnly) {
    relaxations.push({ label: "Step-free only", relaxed: { ...filters, stepFreeOnly: false } });
  }
  if (filters.openNow) {
    relaxations.push({ label: "Open now", relaxed: { ...filters, openNow: false } });
  }
  if (filters.timeOfDay !== "any") {
    relaxations.push({ label: "Time of day", relaxed: { ...filters, timeOfDay: "any" } });
  }

  if (relaxations.length === 0) return null;

  let bestLabel: string | null = null;
  let bestPoolSize = -1;
  for (const { label, relaxed } of relaxations) {
    const rows = await buildPlaceQuery(relaxed);
    const finalRows = filterOpenNow(rows, relaxed.openNow);
    if (finalRows.length > bestPoolSize) {
      bestPoolSize = finalRows.length;
      bestLabel = label;
    }
  }

  if (bestLabel === null) return null;
  return { label: bestLabel, poolSizeIfRelaxed: bestPoolSize };
}
