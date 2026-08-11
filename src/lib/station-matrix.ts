import { readFileSync } from "node:fs";
import path from "node:path";
import { StationSchema, type Station } from "./schemas";

/**
 * In-memory lookup over the precomputed station graph built by
 * scripts/build-station-matrix.ts. This is a lookup, not a live routing
 * call — per CONTRACT.md, `data/gtfs/station-matrix.json` is loaded once
 * and cached in module scope.
 */

export interface TravelResult {
  minutes: number;
  transfers: number;
  viaLine: string;
}

interface RawTravelTime {
  from: string;
  to: string;
  minutes: number;
  transfers: number;
  viaLine: string;
}

interface StationMatrixFile {
  stations: Station[];
  travelTimes: RawTravelTime[];
}

let stations: Station[] | null = null;
let stationsById: Map<string, Station> | null = null;
// Keyed both directions ("A|B" and "B|A") so travelBetween is a plain
// lookup regardless of argument order — the file only stores one
// direction per unordered pair (per CONTRACT.md) and is symmetric at
// lookup time.
let travelIndex: Map<string, TravelResult> | null = null;

function dataFilePath(): string {
  return path.join(process.cwd(), "data", "gtfs", "station-matrix.json");
}

/** Reads and validates data/gtfs/station-matrix.json into memory once. Idempotent. */
export function loadStationMatrix(): void {
  if (stations !== null) return; // already loaded

  const raw = readFileSync(dataFilePath(), "utf8");
  const parsed = JSON.parse(raw) as StationMatrixFile;

  const validatedStations = parsed.stations.map((s) => StationSchema.parse(s));

  const byId = new Map<string, Station>();
  for (const s of validatedStations) byId.set(s.id, s);

  const index = new Map<string, TravelResult>();
  for (const t of parsed.travelTimes) {
    const result: TravelResult = { minutes: t.minutes, transfers: t.transfers, viaLine: t.viaLine };
    index.set(`${t.from}|${t.to}`, result);
    index.set(`${t.to}|${t.from}`, result);
  }

  stations = validatedStations;
  stationsById = byId;
  travelIndex = index;
}

function ensureLoaded(): void {
  if (stations === null) loadStationMatrix();
}

/** Haversine distance in meters — kept local so this module has no dependency on the scripts/ tree. */
function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const WALK_METERS_PER_MINUTE = 80;
const MAX_WALK_MINUTES = 45;

/** Nearest station to a lat/lon by straight-line distance, with the implied walk time. */
export function nearestStation(lat: number, lon: number): { station: Station; walkMinutes: number } | null {
  ensureLoaded();
  if (!stations || stations.length === 0) return null;

  let best: Station | null = null;
  let bestDist = Infinity;
  for (const s of stations) {
    const d = haversineMeters(lat, lon, s.lat, s.lon);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (!best) return null;
  const walkMinutes = Math.min(Math.round((bestDist / WALK_METERS_PER_MINUTE) * 10) / 10, MAX_WALK_MINUTES);
  return { station: best, walkMinutes };
}

/** Precomputed travel time/transfers/dominant-line between two stations. Null if unreachable (e.g. Staten Island Railway to the rest of the network) or unknown ids. */
export function travelBetween(fromStationId: string, toStationId: string): TravelResult | null {
  ensureLoaded();
  if (!stationsById || !travelIndex) return null;
  if (fromStationId === toStationId) return { minutes: 0, transfers: 0, viaLine: "" };
  if (!stationsById.has(fromStationId) || !stationsById.has(toStationId)) return null;
  return travelIndex.get(`${fromStationId}|${toStationId}`) ?? null;
}

/** All loaded stations — exposed for callers that need to enumerate (e.g. filters UI). */
export function allStations(): Station[] {
  ensureLoaded();
  return stations ?? [];
}
