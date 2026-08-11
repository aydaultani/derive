import type { Category } from "../../src/lib/schemas";

/**
 * Derives a single DERIVE `Category` from raw OSM tags. OSM tagging is
 * multi-dimensional (a place can be `historic` AND `tourism=museum` AND
 * `amenity=cafe` all at once); we need exactly one bucket, so this is a
 * priority-ordered mapping table, most-specific first. Anything
 * unclassifiable-but-interesting that reaches the bottom falls into
 * `weird` rather than being dropped — see CONTRACT/task brief.
 */

const DRINK_AMENITIES = new Set(["bar", "pub", "biergarten", "nightclub"]);
const FOOD_AMENITIES = new Set(["cafe", "restaurant", "fast_food", "ice_cream", "food_court"]);
const ART_AMENITIES = new Set(["arts_centre", "theatre", "cinema", "planetarium"]);
const WATER_LEISURE = new Set(["marina", "fishing", "swimming_pool"]);
const PARK_LEISURE = new Set(["park", "garden", "nature_reserve", "playground", "dog_park", "beach_resort", "bird_hide"]);
const WATER_NATURAL = new Set(["water", "wetland", "bay", "spring", "beach"]);
const PARK_NATURAL = new Set(["wood", "scrub"]);
const PARK_TOURISM = new Set(["picnic_site", "camp_site"]);
const ART_TOURISM = new Set(["museum", "gallery", "artwork"]);

export function deriveCategory(tags: Record<string, string>): Category {
  if (tags.railway) return "transit-oddity";

  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.tourism && ART_TOURISM.has(tags.tourism)) return "art";
  if (tags.tourism && PARK_TOURISM.has(tags.tourism)) return "park";

  if (tags.historic) return "historic";

  if (tags.amenity === "place_of_worship") return "historic";
  if (tags.amenity && DRINK_AMENITIES.has(tags.amenity)) return "drink";
  if (tags.amenity && FOOD_AMENITIES.has(tags.amenity)) return "food";
  if (tags.amenity && ART_AMENITIES.has(tags.amenity)) return "art";

  if (tags.leisure && WATER_LEISURE.has(tags.leisure)) return "water";
  if (tags.leisure && PARK_LEISURE.has(tags.leisure)) return "park";

  if (tags.natural && WATER_NATURAL.has(tags.natural)) return "water";
  if (tags.natural && PARK_NATURAL.has(tags.natural)) return "park";
  if (tags.natural) return "weird"; // cliff, peninsula, cave_entrance, ...

  if (tags.shop) return "shop";

  // Any remaining tourism (attraction, zoo, aquarium, theme_park,
  // information, ...), amenity (library, community_centre, fountain,
  // clock, marketplace, public_bookcase, monastery, social_centre, ...),
  // or leisure (golf_course, ice_rink, fitness_centre, stadium, ...) value
  // that didn't match a more specific bucket above is genuinely odd/loose
  // rather than unclassifiable — that's what `weird` is for.
  return "weird";
}
