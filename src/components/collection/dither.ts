/**
 * Deterministic ASCII dither pattern generator for grid cells — same
 * ▓ (filled) / ░ (empty) vocabulary as the card-reveal dither field
 * described in CONTRACT.md's wireframe, at grid-cell scale. Not shared
 * code with the reveal component (owned by the ui-core track, not present
 * in this worktree), but deliberately the same visual language: no glow,
 * no gradients, density-only texture keyed off rarity.
 *
 * These density values mirror `--dither-{tier}` in `src/app/globals.css`
 * (0.12/0.28/0.48/0.72/0.94) — that file is the source of truth (read-only
 * for this track); if it changes, update this map to match.
 */
export const TIER_DITHER_DENSITY: Record<string, number> = {
  common: 0.12,
  uncommon: 0.28,
  rare: 0.48,
  epic: 0.72,
  legendary: 0.94,
};

/** Ghost density for cells with no completed card — sparse, deliberately
 * below even "common" so lit cells always read as denser at a glance. */
export const GHOST_DITHER_DENSITY = 0.08;

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rows of ▓/░ glyphs, deterministic per `seed` (a place id) so a cell's
 * texture never changes between renders. */
export function seededDitherGrid(seed: string, density: number, rows = 3, cols = 5): string[] {
  const rand = mulberry32(hashString(seed));
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      line += rand() < density ? "▓" : "░";
    }
    lines.push(line);
  }
  return lines;
}
