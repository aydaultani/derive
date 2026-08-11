import { createHash } from "node:crypto";

/**
 * mulberry32 — small, fast, well-known deterministic PRNG.
 * Not cryptographically secure; fine for a game roll that only needs to be
 * reproducible and reasonably well-distributed.
 *
 * Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turns an arbitrary seed string into a deterministic generator of numbers
 * in [0, 1). The seed is first run through sha256 (via node:crypto) so that
 * similar-looking seeds (e.g. adjacent dealtDate values, or userIds that
 * differ by one character) diffuse into unrelated 32-bit integers instead of
 * producing visibly correlated PRNG streams. The first 4 bytes of the digest
 * become the mulberry32 seed.
 *
 * Calling this twice with the same `seed` string always yields a generator
 * that produces the same sequence of values — this is what makes
 * `rollCard(pool, userId, dealtDate)` a pure, reproducible function.
 */
export function createSeededRandom(seed: string): () => number {
  const digest = createHash("sha256").update(seed).digest();
  const seedInt = digest.readUInt32BE(0);
  return mulberry32(seedInt);
}
