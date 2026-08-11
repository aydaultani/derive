import type { BBox } from "./geo";

/**
 * Curated OSM tag-value allowlists used for the borough-wide queries.
 * These keep the borough pulls scoped to "interesting" places instead of
 * every parking lot and waste basket in NYC (an unfiltered pull of
 * amenity/leisure/natural/shop for all five boroughs would be hundreds of
 * thousands of nodes — too slow and too large to commit, per the brief).
 * The far-out neighborhood queries (see nyc-geo.ts) intentionally skip
 * this allowlist since point density there is already low.
 */
const AMENITY_VALUES = [
  "bar", "cafe", "restaurant", "pub", "biergarten", "ice_cream", "fast_food",
  "food_court", "arts_centre", "community_centre", "fountain", "clock",
  "place_of_worship", "library", "theatre", "cinema", "nightclub",
  "marketplace", "public_bookcase", "monastery", "planetarium", "social_centre",
];
const LEISURE_VALUES = [
  "park", "garden", "nature_reserve", "playground", "marina", "golf_course",
  "dog_park", "ice_rink", "fitness_centre", "bird_hide", "fishing",
  "swimming_pool", "stadium", "beach_resort",
];
const NATURAL_VALUES = [
  "water", "wood", "beach", "cliff", "peninsula", "wetland", "cave_entrance",
  "spring", "bay", "scrub",
];
const SHOP_VALUES = [
  "antiques", "art", "books", "gift", "music", "second_hand", "variety_store",
  "department_store", "deli", "chocolate", "tea", "coffee", "farm", "florist",
  "games", "toys",
];
const RAILWAY_VALUES = ["disused", "subway_entrance", "halt"];

function altRegex(values: string[]): string {
  return `^(${values.join("|")})$`;
}

function bboxStr(b: BBox): string {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

/** Curated, tag-value-filtered query for a whole borough bounding box. */
export function buildBoroughQuery(bbox: BBox): string {
  const b = bboxStr(bbox);
  return `[out:json][timeout:180];(
  node["tourism"](${b}); way["tourism"](${b});
  node["historic"](${b}); way["historic"](${b});
  node["amenity"~"${altRegex(AMENITY_VALUES)}"](${b}); way["amenity"~"${altRegex(AMENITY_VALUES)}"](${b});
  node["leisure"~"${altRegex(LEISURE_VALUES)}"](${b}); way["leisure"~"${altRegex(LEISURE_VALUES)}"](${b});
  node["natural"~"${altRegex(NATURAL_VALUES)}"](${b}); way["natural"~"${altRegex(NATURAL_VALUES)}"](${b});
  node["shop"~"${altRegex(SHOP_VALUES)}"](${b}); way["shop"~"${altRegex(SHOP_VALUES)}"](${b});
  node["railway"~"${altRegex(RAILWAY_VALUES)}"](${b}); way["railway"~"${altRegex(RAILWAY_VALUES)}"](${b});
); out center tags;`;
}

/**
 * Broad (unfiltered within these six root tags), radius-scoped query used
 * for the deliberately-included far-out/obscure neighborhoods, where point
 * density is low enough that a curated allowlist would return almost
 * nothing.
 */
export function buildAroundQuery(lat: number, lon: number, radiusM: number): string {
  const around = `around:${radiusM},${lat},${lon}`;
  return `[out:json][timeout:120];(
  node["tourism"](${around}); way["tourism"](${around});
  node["historic"](${around}); way["historic"](${around});
  node["amenity"](${around}); way["amenity"](${around});
  node["leisure"](${around}); way["leisure"](${around});
  node["natural"](${around}); way["natural"](${around});
  node["shop"](${around}); way["shop"](${around});
  node["railway"](${around}); way["railway"](${around});
); out center tags;`;
}
