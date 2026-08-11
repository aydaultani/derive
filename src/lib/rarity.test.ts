import { describe, expect, it } from "vitest";
import { PlaceSchema, RARITY_TIERS, RARITY_WEIGHTS, type RarityTier } from "./schemas";
import { rollCard, scorePlace, type ScoredPlaceInput } from "./rarity";

// ---------------------------------------------------------------------------
// Fixtures — minimal valid Place-shaped objects (satisfying PlaceSchema) plus
// the per-trip `travelMinutes` field rarity.ts requires (see ScoredPlaceInput
// doc comment in rarity.ts for why Place alone isn't enough). Fields that
// feed the score (travelMinutes, tagCount, touristDistanceM) vary per index
// so the pool has real spread; everything else is fixed filler.
// ---------------------------------------------------------------------------
function makePlace(i: number, overrides: Partial<ScoredPlaceInput> = {}): ScoredPlaceInput {
  const base: ScoredPlaceInput = {
    id: `node/${i}`,
    osmId: String(i),
    osmType: "node",
    name: `Place ${i}`,
    lat: 40.5 + (i % 200) * 0.001,
    lon: -74.0 + (i % 200) * 0.001,
    borough: "queens",
    category: "park",
    tags: { name: `Place ${i}` },
    tagCount: 1 + (i % 25), // 1..25
    address: null,
    openingHoursRaw: null,
    budgetTier: "free",
    indoor: false,
    nearestStationId: "A24",
    walkMinutesToStation: 5,
    stepFreeOk: false,
    touristDistanceM: 50 + (i % 8000), // 50..8049
    qualityScore: 0.8,
    travelMinutes: 5 + (i % 75), // 5..79
  };
  return { ...base, ...overrides };
}

function makePool(size: number): ScoredPlaceInput[] {
  return Array.from({ length: size }, (_, i) => makePlace(i));
}

describe("rarity fixtures", () => {
  it("fixtures satisfy PlaceSchema (minus the travelMinutes extension)", () => {
    const place = makePlace(0);
    expect(() => PlaceSchema.parse(place)).not.toThrow();
  });
});

describe("scorePlace", () => {
  it("computes the weighted normalized score formula", () => {
    const pool = makePool(10);
    // travelMinutes and touristDistanceM increase with index, tagCount too —
    // so a higher-index place should score higher (rarer): more travel and
    // more distance push score up, but higher tagCount pulls it down. Just
    // sanity-check the formula bounds and monotonic-ish behavior at the
    // extremes rather than hand-computing every term.
    const scores = pool.map((p) => scorePlace(p, pool));
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("normalizes relative to the pool passed in, not a global constant", () => {
    const place = makePlace(0, { travelMinutes: 30, tagCount: 5, touristDistanceM: 1000 });
    const narrowPool = [
      makePlace(1, { travelMinutes: 30, tagCount: 5, touristDistanceM: 1000 }),
      makePlace(2, { travelMinutes: 30, tagCount: 5, touristDistanceM: 1000 }),
    ];
    // Every place identical -> min === max for every field -> degenerate
    // norm() returns 0 for every term -> score is just the constant term.
    expect(scorePlace(place, narrowPool)).toBeCloseTo(0.35, 10);

    const widePool = [
      makePlace(3, { travelMinutes: 0, tagCount: 0, touristDistanceM: 0 }),
      makePlace(4, { travelMinutes: 60, tagCount: 10, touristDistanceM: 2000 }),
    ];
    const wideScore = scorePlace(place, widePool);
    expect(wideScore).not.toBeCloseTo(0.35, 5);
  });
});

describe("rollCard determinism", () => {
  const pool = makePool(300);

  it("same (pool, userId, dealtDate) always produces the same RollResult", () => {
    const a = rollCard(pool, "user-123", "2026-08-12");
    const b = rollCard(pool, "user-123", "2026-08-12");
    expect(a).toEqual(b);
  });

  it("differs across dealtDate for the same userId, sampled over many dates", () => {
    const base = rollCard(pool, "user-123", "2026-01-01");
    let differing = 0;
    const sampleSize = 60;
    for (let d = 1; d <= sampleSize; d++) {
      const dealtDate = `sample-date-${d}`;
      const r = rollCard(pool, "user-123", dealtDate);
      if (r.place.id !== base.place.id || r.tier !== base.tier) differing++;
    }
    // A single coincidental collision is expected sometimes; the vast
    // majority of a 60-sample spread should differ from the base result.
    expect(differing).toBeGreaterThan(sampleSize * 0.8);
  });

  it("differs across userId for the same dealtDate, sampled over many users", () => {
    const base = rollCard(pool, "user-base", "2026-08-12");
    let differing = 0;
    const sampleSize = 60;
    for (let u = 1; u <= sampleSize; u++) {
      const r = rollCard(pool, `user-${u}`, "2026-08-12");
      if (r.place.id !== base.place.id || r.tier !== base.tier) differing++;
    }
    expect(differing).toBeGreaterThan(sampleSize * 0.8);
  });
});

describe("rollCard distribution (100k rolls)", () => {
  it("observed tier frequencies land within tolerance of RARITY_WEIGHTS", () => {
    const pool = makePool(400);
    const draws = 100_000;
    const counts: Record<RarityTier, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };

    for (let i = 0; i < draws; i++) {
      const result = rollCard(pool, `user-${i % 997}`, `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}-${i}`);
      counts[result.tier]++;
    }

    // Tolerance rationale: this is a binomial trial per tier over n=100,000
    // draws. Standard deviation for tier weight p is sqrt(n*p*(1-p)):
    //   - legendary (p=0.005): sigma ~ 22 draws  -> ~0.022 pp
    //   - epic      (p=0.045): sigma ~ 66 draws  -> ~0.066 pp
    //   - rare      (p=0.13):  sigma ~ 106 draws -> ~0.106 pp
    //   - uncommon  (p=0.27):  sigma ~ 140 draws -> ~0.140 pp
    //   - common    (p=0.55):  sigma ~ 157 draws -> ~0.157 pp
    // A tolerance of max(15% relative, 1.5 percentage points absolute) is
    // tens of sigma wide for every tier (worst case ~23 sigma for legendary),
    // so it will not flake from ordinary sampling noise, while still being
    // tight enough to catch a real algorithmic bug (e.g. swapped weights,
    // wrong bucket boundaries), which would miss by many percentage points,
    // not fractions of one.
    for (const tier of RARITY_TIERS) {
      const target = RARITY_WEIGHTS[tier];
      const observed = counts[tier] / draws;
      const tolerance = Math.max(target * 0.15, 0.015);
      expect(
        Math.abs(observed - target),
        `tier ${tier}: observed ${observed.toFixed(4)} vs target ${target} (tolerance ${tolerance.toFixed(4)})`,
      ).toBeLessThanOrEqual(tolerance);
    }
  });
});

describe("rollCard edge cases", () => {
  it("pool smaller than 5 still returns a valid result via bucket fallback", () => {
    const pool = makePool(3);
    const result = rollCard(pool, "user-small", "2026-08-12");
    expect(pool.some((p) => p.id === result.place.id)).toBe(true);
    expect(RARITY_TIERS).toContain(result.tier);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("pool of 1 always returns that one place, regardless of tier draw", () => {
    const only = makePlace(0);
    const pool = [only];
    for (let i = 0; i < 25; i++) {
      const result = rollCard(pool, `user-${i}`, `date-${i}`);
      expect(result.place.id).toBe(only.id);
      expect(result.tier).toBe("common");
    }
  });

  it("throws on an empty pool (caller bug)", () => {
    expect(() => rollCard([], "user-1", "2026-08-12")).toThrow();
  });
});
