import type { Place, RarityTier } from "./schemas";
import { RARITY_TIERS, RARITY_WEIGHTS } from "./schemas";
import { createSeededRandom } from "./seeded-random";

/**
 * CONTRACT.md pins `scorePlace(place: Place, pool: Place[])` and
 * `rollCard(pool: Place[], userId, dealtDate)`. In practice `Place` (from
 * src/lib/schemas.ts) is the *static*, per-place output of the OSM ingest
 * pipeline — it has no `travelMinutes` field, because travel time depends on
 * the rider's origin station for a specific trip, not on the place itself.
 * `Card` (also in schemas.ts) *does* carry `travelMinutes`, confirming it's
 * computed per-request — by the spin-api track, via
 * `station-matrix.travelBetween()` — not baked into `Place`.
 *
 * So this module accepts `ScoredPlaceInput = Place & { travelMinutes: number }`
 * instead of bare `Place`. This is the smallest possible deviation from the
 * pinned signature: every `Place` field is still present and untouched, one
 * field is added. The spin-api track should build this array by merging each
 * candidate `Place`'s `travelBetween(originStation, place.nearestStationId)`
 * result onto it before calling `rollCard`. `RollResult.place` is typed as
 * `ScoredPlaceInput` (a strict superset of `Place`) for the same reason.
 */
export type ScoredPlaceInput = Place & { travelMinutes: number };

export interface RollResult {
  place: ScoredPlaceInput;
  tier: RarityTier;
  score: number;
}

interface MinMax {
  min: number;
  max: number;
}

interface PoolStats {
  travel: MinMax;
  tags: MinMax;
  tourist: MinMax;
}

interface ScoredEntry {
  place: ScoredPlaceInput;
  score: number;
}

function fieldMinMax(pool: readonly ScoredPlaceInput[], selector: (p: ScoredPlaceInput) => number): MinMax {
  let min = Infinity;
  let max = -Infinity;
  for (const place of pool) {
    const value = selector(place);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** Min-max normalize `value` into [0, 1] relative to [min, max]. Degenerate
 * pools (every place shares the same value, min === max) normalize to 0 —
 * there's no signal to extract, so the term contributes nothing rather than
 * NaN. */
function norm(value: number, { min, max }: MinMax): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

function computePoolStats(pool: readonly ScoredPlaceInput[]): PoolStats {
  return {
    travel: fieldMinMax(pool, (p) => p.travelMinutes),
    tags: fieldMinMax(pool, (p) => p.tagCount),
    tourist: fieldMinMax(pool, (p) => p.touristDistanceM),
  };
}

function scoreWithStats(place: ScoredPlaceInput, stats: PoolStats): number {
  const normTravel = norm(place.travelMinutes, stats.travel);
  const normTags = norm(place.tagCount, stats.tags);
  const normTourist = norm(place.touristDistanceM, stats.tourist);
  return 0.45 * normTravel + 0.35 * (1 - normTags) + 0.2 * normTourist;
}

/**
 * score = 0.45 * norm(travelMinutes)
 *       + 0.35 * (1 - norm(tagCount))
 *       + 0.20 * norm(touristDistanceM)
 *
 * `norm()` min-max normalizes each field across `pool` (not a global
 * constant) — a place is rarer relative to what's actually in today's
 * filtered candidate set, per CONTRACT.md.
 *
 * Note: this recomputes pool-wide min/max on every call, which is O(pool
 * size). `rollCard` below scores its whole pool in one pass instead of
 * calling this per-place, to avoid the O(n^2) cost of doing that n times.
 */
export function scorePlace(place: ScoredPlaceInput, pool: ScoredPlaceInput[]): number {
  return scoreWithStats(place, computePoolStats(pool));
}

/**
 * Sorts `entries` ascending by score (already done by the caller) and slices
 * it into contiguous buckets sized by cumulative `RARITY_WEIGHTS`, in
 * `RARITY_TIERS` order (common ... legendary). Low score = common (short
 * travel, well-tagged, close to tourist attractions); high score =
 * legendary. The last tier absorbs any leftover from rounding so every
 * entry lands in exactly one bucket.
 */
function bucketPool(sortedAscending: readonly ScoredEntry[]): Record<RarityTier, ScoredEntry[]> {
  const n = sortedAscending.length;
  const buckets = {} as Record<RarityTier, ScoredEntry[]>;
  let cumulativeWeight = 0;
  let startIdx = 0;
  RARITY_TIERS.forEach((tier, i) => {
    cumulativeWeight += RARITY_WEIGHTS[tier];
    const isLast = i === RARITY_TIERS.length - 1;
    const endIdx = isLast ? n : Math.round(cumulativeWeight * n);
    buckets[tier] = sortedAscending.slice(startIdx, endIdx);
    startIdx = endIdx;
  });
  return buckets;
}

/** Weighted-random tier pick from a single `rng()` draw in [0, 1). */
function pickWeightedTier(rng: () => number): RarityTier {
  const r = rng();
  let cumulative = 0;
  for (const tier of RARITY_TIERS) {
    cumulative += RARITY_WEIGHTS[tier];
    if (r < cumulative) return tier;
  }
  // Floating-point safety net: cumulative weights sum to 1 but rounding
  // error could leave r >= cumulative after the loop (e.g. r === 0.999999999).
  return RARITY_TIERS[RARITY_TIERS.length - 1];
}

/**
 * If `tier`'s bucket is empty (tiny filtered pool), fall back to the
 * nearest non-empty tier *below* it in rarity (legendary -> epic -> rare ->
 * uncommon -> common). Every entry in the pool lands in some bucket
 * (`bucketPool` partitions the whole array), so as long as `pool` is
 * non-empty at least one bucket is non-empty — the throw below only fires
 * if that invariant is somehow violated, which is a caller bug (empty pool
 * reaching `rollCard`).
 */
function resolveTierWithFallback(tier: RarityTier, buckets: Record<RarityTier, ScoredEntry[]>): RarityTier {
  const startIdx = RARITY_TIERS.indexOf(tier);
  for (let i = startIdx; i >= 0; i--) {
    const candidate = RARITY_TIERS[i];
    if (buckets[candidate].length > 0) return candidate;
  }
  throw new Error(
    "rollCard: no non-empty rarity bucket found. This means an empty pool reached rollCard — filter upstream before calling.",
  );
}

/**
 * Deals one card for `(userId, dealtDate)` from `pool`. Pure function of its
 * three arguments: same inputs always produce the same `RollResult`, which
 * is what makes "no rerolls, refresh doesn't reroll" true. `pool` must be
 * non-empty — an empty pool reaching this function is a caller bug (should
 * be caught upstream as a "pool too small" filter error) and throws.
 */
export function rollCard(pool: ScoredPlaceInput[], userId: string, dealtDate: string): RollResult {
  if (pool.length === 0) {
    throw new Error("rollCard: pool must not be empty (caller bug — filter upstream, e.g. pool_too_small).");
  }

  const stats = computePoolStats(pool);
  const scored: ScoredEntry[] = pool.map((place) => ({ place, score: scoreWithStats(place, stats) }));
  scored.sort((a, b) => a.score - b.score);

  const buckets = bucketPool(scored);

  const rng = createSeededRandom(`${userId}:${dealtDate}`);
  const drawnTier = pickWeightedTier(rng); // draw #1
  const tier = resolveTierWithFallback(drawnTier, buckets);

  const bucket = buckets[tier];
  const idx = Math.min(Math.floor(rng() * bucket.length), bucket.length - 1); // draw #2
  const chosen = bucket[idx];

  return { place: chosen.place, tier, score: chosen.score };
}
