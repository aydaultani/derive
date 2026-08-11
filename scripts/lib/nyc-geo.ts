import type { Borough } from "../../src/lib/schemas";
import { haversineMeters, pointInBBox, type BBox, type LatLon } from "./geo";

/**
 * Approximate bounding boxes for NYC's five boroughs (south, west, north,
 * east). Good enough for scoping Overpass queries and for a borough-guess
 * heuristic when classifying GTFS stations — not meant to be a precise
 * administrative boundary (a handful of stations near borough lines could
 * be misclassified; documented here rather than pulling in a full GeoJSON
 * boundary dataset for a one-time approximation).
 */
export const BOROUGH_BBOXES: Record<Borough, BBox> = {
  manhattan: { south: 40.6800, west: -74.0480, north: 40.8804, east: -73.9067 },
  brooklyn: { south: 40.5707, west: -74.0421, north: 40.7395, east: -73.8334 },
  queens: { south: 40.5410, west: -73.9626, north: 40.8007, east: -73.7004 },
  bronx: { south: 40.7855, west: -73.9339, north: 40.9153, east: -73.7654 },
  staten_island: { south: 40.4960, west: -74.2557, north: 40.6514, east: -74.0522 },
};

export interface FarOutSpot {
  label: string;
  borough: Borough;
  lat: number;
  lon: number;
  radiusM: number;
}

/**
 * Deliberately-included obscure/far-flung neighborhoods so Legendary tier
 * (long travel time + tag-sparse + far from the tourist-attraction
 * centroid) has real material instead of just being "whatever's left after
 * filtering Manhattan." These get a broader (unfiltered) Overpass tag net
 * than the borough-wide queries because point density out here is low.
 */
export const FAR_OUT_SPOTS: FarOutSpot[] = [
  { label: "Rockaway", borough: "queens", lat: 40.5885, lon: -73.8145, radiusM: 3500 },
  { label: "Broad Channel", borough: "queens", lat: 40.6087, lon: -73.8200, radiusM: 1600 },
  { label: "City Island", borough: "bronx", lat: 40.8470, lon: -73.7860, radiusM: 1800 },
  { label: "Tottenville", borough: "staten_island", lat: 40.5054, lon: -74.2454, radiusM: 2200 },
  { label: "City Line", borough: "brooklyn", lat: 40.6805, lon: -73.8746, radiusM: 1500 },
];

/**
 * Point-in-borough-bbox test with a nearest-bbox-center fallback for
 * points that fall just outside every rectangle (piers, etc). Shared by
 * both the OSM place ingest and the GTFS station-matrix build so borough
 * assignment is consistent across the two data sources.
 */
export function boroughForPoint(p: LatLon): Borough {
  for (const [borough, bbox] of Object.entries(BOROUGH_BBOXES) as [Borough, BBox][]) {
    if (pointInBBox(p, bbox)) return borough;
  }
  let best: Borough = "manhattan";
  let bestDist = Infinity;
  for (const [borough, bbox] of Object.entries(BOROUGH_BBOXES) as [Borough, BBox][]) {
    const center = { lat: (bbox.south + bbox.north) / 2, lon: (bbox.west + bbox.east) / 2 };
    const d = haversineMeters(p, center);
    if (d < bestDist) {
      bestDist = d;
      best = borough;
    }
  }
  return best;
}
