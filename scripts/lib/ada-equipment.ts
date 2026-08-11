/**
 * MTA Subway Elevator and Escalator Asset Inventory (Socrata / data.ny.gov,
 * dataset id 94fv-bak7 — found via the Socrata catalog search API since
 * the exact resource id isn't published anywhere obvious; see
 * scripts/README.md). No API key needed for reasonable read volumes.
 *
 * We only care about elevators (escalators don't make a station
 * wheelchair-accessible) that are currently in service, and only need
 * their coordinates — station-level ADA status is then "is there a
 * functioning elevator within ~250m of this station's platform
 * coordinates", which is a reasonable proxy given we don't have a direct
 * GTFS-stop-id join key that's populated on every row.
 *
 * Degrades to an empty list (caller then marks every station ada:false)
 * if the dataset is unreachable — documented in build-station-matrix.ts
 * and in the final ingest report, per the task brief.
 */

const DATASET_URL = "https://data.ny.gov/resource/94fv-bak7.json?$limit=2000&elevator_or_escalator=Elevator";
const USER_AGENT = "derive-dev/0.1 (NYC subway-discovery app; one-time data ingest; contact ad7994@nyu.edu)";
const REQUEST_TIMEOUT_MS = 30_000;

export interface AdaElevatorPoint {
  lat: number;
  lon: number;
  inService: boolean;
}

interface SocrataElevatorRow {
  elevator_or_escalator?: string;
  service_status_code?: string;
  service_status?: string;
  x_coordinate?: string;
  y_coordinate?: string;
  georeference?: { type: string; coordinates: [number, number] };
}

export async function fetchAdaElevators(): Promise<AdaElevatorPoint[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(DATASET_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[ada] MTA elevator dataset responded ${res.status}. Falling back to ada:false for all stations.`);
      return [];
    }
    const rows = (await res.json()) as SocrataElevatorRow[];
    const points: AdaElevatorPoint[] = [];
    for (const row of rows) {
      let lat: number | undefined;
      let lon: number | undefined;
      if (row.georeference?.coordinates) {
        [lon, lat] = row.georeference.coordinates;
      } else if (row.x_coordinate && row.y_coordinate) {
        lat = Number(row.x_coordinate);
        lon = Number(row.y_coordinate);
      }
      if (lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) continue;
      const inService = row.service_status_code === "IFIS";
      points.push({ lat, lon, inService });
    }
    return points;
  } catch (err) {
    console.warn(`[ada] Failed to fetch MTA elevator dataset — ${(err as Error).message}. Falling back to ada:false for all stations.`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
