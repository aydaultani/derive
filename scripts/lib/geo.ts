/**
 * Small geo helpers shared by the data-pipeline scripts. Pure functions,
 * no I/O — kept dependency-free on purpose.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/lon points, in meters. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/** Arithmetic-mean centroid. Fine at city scale (no need for spherical centroid math). */
export function centroid(points: LatLon[]): LatLon | null {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }),
    { lat: 0, lon: 0 },
  );
  return { lat: sum.lat / points.length, lon: sum.lon / points.length };
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function pointInBBox(p: LatLon, box: BBox): boolean {
  return p.lat >= box.south && p.lat <= box.north && p.lon >= box.west && p.lon <= box.east;
}

/** Walk speed used across the pipeline: 80 meters/minute (~3mph), capped for sanity. */
export const WALK_METERS_PER_MINUTE = 80;
export const MAX_WALK_MINUTES = 45;

export function walkMinutes(distanceM: number): number {
  const minutes = distanceM / WALK_METERS_PER_MINUTE;
  return Math.min(Math.round(minutes * 10) / 10, MAX_WALK_MINUTES);
}
