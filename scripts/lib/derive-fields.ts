import type { BudgetTier, Category } from "../../src/lib/schemas";

/**
 * budgetTier: only ever claim "free" when we have real evidence — either
 * an explicit `fee=no` tag, or the place is in a category that is
 * overwhelmingly free-to-enter as public outdoor space in NYC (parks,
 * waterfront/natural features, viewpoints) AND has no fee tag saying
 * otherwise. `fee=yes`/`fee=interval` tells us there IS a cost but not how
 * much, so that maps to "any" rather than guessing "under_15" — the brief
 * is explicit: never fabricate a wrong "free". Everything else defaults to
 * "any" (unknown).
 */
const INHERENTLY_FREE_CATEGORIES = new Set<Category>(["park", "water", "viewpoint"]);

export function deriveBudgetTier(tags: Record<string, string>, category: Category): BudgetTier {
  if (tags.fee === "no") return "free";
  if (tags.fee) return "any"; // fee=yes / fee=interval / other — cost exists, magnitude unknown
  if (INHERENTLY_FREE_CATEGORIES.has(category)) return "free";
  return "any";
}

/**
 * indoor: derived from an explicit `indoor` tag first, then `building`
 * (anything but building=no), then a set of amenity/tourism/shop values
 * that are inherently indoor establishments. Outdoor leisure/natural
 * categories default to false. Falls back to false when genuinely
 * ambiguous (a bare `historic=memorial` with no building tag, etc.) since
 * most historic markers/monuments in NYC OSM data are outdoor street
 * furniture rather than buildings.
 */
const INDOOR_AMENITIES = new Set([
  "cafe", "restaurant", "fast_food", "food_court", "bar", "pub", "biergarten",
  "nightclub", "arts_centre", "theatre", "cinema", "planetarium", "library",
  "community_centre", "social_centre", "place_of_worship", "monastery",
]);
const INDOOR_TOURISM = new Set(["museum", "gallery", "aquarium"]);

export function deriveIndoor(tags: Record<string, string>): boolean {
  if (tags.indoor === "yes") return true;
  if (tags.indoor === "no") return false;
  if (tags.building && tags.building !== "no") return true;
  if (tags.amenity && INDOOR_AMENITIES.has(tags.amenity)) return true;
  if (tags.tourism && INDOOR_TOURISM.has(tags.tourism)) return true;
  if (tags.shop) return true; // shops in our allowlist are all storefronts
  return false;
}

/** Best-effort human-readable address from addr:* tags. Never fabricated. */
export function deriveAddress(tags: Record<string, string>): string | null {
  if (tags["addr:housenumber"] && tags["addr:street"]) {
    return `${tags["addr:housenumber"]} ${tags["addr:street"]}`;
  }
  if (tags["addr:street"]) return tags["addr:street"];
  if (tags["addr:full"]) return tags["addr:full"];
  return null;
}

/**
 * stepFreeOk: true only when OSM explicitly says wheelchair access is
 * fully fine (`wheelchair=yes`). `limited` means partial/step access
 * exists somewhere but isn't guaranteed step-free, so it does not count —
 * same "never fabricate a positive" principle as budgetTier.
 */
export function deriveStepFreeOk(tags: Record<string, string>): boolean {
  return tags.wheelchair === "yes";
}
