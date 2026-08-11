/**
 * Runtime mirror of `RARITY_WEIGHTS` from `src/lib/schemas.ts` (see the
 * comment on that export). The data-pipeline scripts don't need the rarity
 * roll itself (that's src/lib/rarity.ts, owned by the rarity-engine track)
 * but this file is the pinned home for the weight table on the pipeline
 * side, kept in exact sync so nothing drifts if either copy changes.
 *
 * If you touch this, touch src/lib/schemas.ts's RARITY_WEIGHTS too (or
 * flag the mismatch in your report) — they must stay identical.
 */
import type { RarityTier } from "../../src/lib/schemas";

export const RARITY_WEIGHTS: Record<RarityTier, number> = {
  common: 0.55,
  uncommon: 0.27,
  rare: 0.13,
  epic: 0.045,
  legendary: 0.005,
};
