import { isLineId, type LineId } from "../../src/lib/mta-lines";

/**
 * GTFS `routes.txt` route_short_name values mostly match our LineId set
 * (`src/lib/mta-lines.ts`) directly (A, C, 1, 7X, SIR, ...). The shuttles
 * (GS/FS/H route_ids) already report short_name "S" in the feed. The one
 * mismatch observed in the current feed is "FX" (a peak-hour F express
 * variant) which isn't its own line color — it rides the F.
 */
const OVERRIDES: Record<string, LineId> = {
  FX: "F",
};

export function normalizeLineId(routeShortName: string): LineId | null {
  const trimmed = routeShortName.trim();
  if (OVERRIDES[trimmed]) return OVERRIDES[trimmed];
  if (isLineId(trimmed)) return trimmed;
  return null;
}
