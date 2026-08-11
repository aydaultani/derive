/**
 * scripts/build-station-matrix.ts
 *
 * One-time precompute of the MTA subway station graph + all-pairs shortest
 * path matrix. Downloads the live GTFS static feed, no key needed. Real
 * network calls — see scripts/README.md to re-run.
 *
 * SIMPLIFICATIONS (documented per the task brief — this is a one-time
 * precompute, not live routing, and these are the right tradeoffs for it):
 *
 *  1. Edge weights are the AVERAGE scheduled travel time between
 *     consecutive stops on a line, pooled across every weekday trip that
 *     covers that segment — not a full time-dependent model. A rider at
 *     3pm and a rider at 11pm get the same number. This is the explicitly
 *     sanctioned simplification ("average-scheduled-time edges ... is fine
 *     and expected").
 *  2. We only look at trips running on the GTFS "Weekday" service_id
 *     (calendar.txt monday=1). Weekday service is the fullest schedule of
 *     the week (every route that runs on the weekend also runs on
 *     weekdays, but not vice versa: W and the peak-only FX do NOT run on
 *     Sundays, for example) so this captures effectively the full line
 *     roster while cutting stop_times.txt parsing from ~565k rows to
 *     ~150k, which is the difference between a script that finishes in
 *     under a minute and one that doesn't need to churn through 7 service
 *     patterns worth of largely-redundant schedule data.
 *  3. Transfers are modeled as a single flat 5-minute penalty applied
 *     whenever the shortest path changes line at a station (an expanded
 *     "(station, line)" graph with same-station cross-line edges weighted
 *     at the penalty) — not the real MTA transfer-specific walk times
 *     (some in-station transfers are 30 seconds, some are a 5-minute
 *     underground walk). Good enough for rarity/travel-time bucketing.
 *  4. Borough-per-station is a bounding-box point-in-rect test (same
 *     boxes as the OSM ingest), not a real administrative boundary lookup
 *     — a handful of stations near a borough line could be misclassified.
 *  5. The Staten Island Railway is topologically disconnected from the
 *     rest of the subway network in this feed (no rail link — the real
 *     connection is the free Staten Island Ferry, which isn't a GTFS
 *     subway trip). All-pairs shortest paths between SIR stations and
 *     everything else are genuinely unreachable and are correctly omitted
 *     from travelTimes rather than fabricated.
 *
 * ADA: MTA's "Subway Elevator and Escalator Asset Inventory" (Socrata
 * dataset 94fv-bak7 on data.ny.gov, found via the catalog search API).
 * A station is `ada: true` when a currently-in-service elevator sits
 * within 250m of its coordinates. If that dataset is unreachable, every
 * station is written with `ada: false` and this is logged loudly — see
 * scripts/lib/ada-equipment.ts.
 */
import AdmZip from "adm-zip";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/db/client";
import { stations as stationsTable, stationTravelTimes } from "../src/db/schema";
import { StationSchema, type Station } from "../src/lib/schemas";
import { ALL_LINES, type LineId } from "../src/lib/mta-lines";
import { fetchAdaElevators } from "./lib/ada-equipment";
import { parseCsv, forEachCsvLine } from "./lib/csv";
import { normalizeLineId } from "./lib/line-ids";
import { boroughForPoint } from "./lib/nyc-geo";
import { haversineMeters, type LatLon } from "./lib/geo";

const GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip";
const USER_AGENT = "derive-dev/0.1 (NYC subway-discovery app; one-time data ingest; contact ad7994@nyu.edu)";
const TRANSFER_PENALTY_MIN = 5;
const ADA_MATCH_RADIUS_M = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGtfsZip(): Promise<Buffer> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const res = await fetch(GTFS_URL, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
        if (!res.ok) throw new Error(`GTFS feed responded ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        return buf;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.warn(`[gtfs] download attempt ${attempt} failed — ${(err as Error).message}`);
      if (attempt === 1) await sleep(3000);
    }
  }
  throw new Error("Could not download the GTFS static feed after 2 attempts. Aborting — no station matrix without it.");
}

function parseGtfsTimeSeconds(hhmmss: string): number {
  const [h, m, s] = hhmmss.split(":").map((n) => Number(n));
  return h * 3600 + m * 60 + s;
}

interface RawStopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  location_type: string;
  parent_station: string;
}

interface EdgeAccumulator {
  sumMinutes: number;
  count: number;
}

async function main(): Promise<void> {
  console.log("[gtfs] downloading MTA GTFS static feed...");
  const zipBuf = await fetchGtfsZip();
  const zip = new AdmZip(zipBuf);
  const readEntry = (name: string): string => {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`GTFS zip missing ${name}`);
    return entry.getData().toString("utf8");
  };

  console.log("[gtfs] parsing routes.txt / calendar.txt / trips.txt / stops.txt...");
  const routeRows = parseCsv(readEntry("routes.txt"));
  const routeShortNameById = new Map<string, string>();
  for (const r of routeRows) routeShortNameById.set(r.route_id, r.route_short_name);

  const calendarRows = parseCsv(readEntry("calendar.txt"));
  const weekdayServiceIds = new Set(calendarRows.filter((r) => r.monday === "1").map((r) => r.service_id));
  if (weekdayServiceIds.size === 0) {
    // Fallback if the feed's calendar shape ever changes: use every service_id.
    console.warn("[gtfs] no calendar.txt service_id had monday=1 — falling back to ALL service_ids (slower, more complete).");
    for (const r of calendarRows) weekdayServiceIds.add(r.service_id);
  }

  const tripRows = parseCsv(readEntry("trips.txt"));
  const routeIdByTripId = new Map<string, string>();
  const weekdayTripIds = new Set<string>();
  for (const t of tripRows) {
    if (weekdayServiceIds.has(t.service_id)) {
      routeIdByTripId.set(t.trip_id, t.route_id);
      weekdayTripIds.add(t.trip_id);
    }
  }
  console.log(`[gtfs] ${weekdayTripIds.size} weekday trips across ${routeRows.length} routes`);

  const stopRows = parseCsv(readEntry("stops.txt")) as unknown as RawStopRow[];
  const rowsById = new Map(stopRows.map((r) => [r.stop_id, r]));
  const childToStation = new Map<string, string>();
  for (const r of stopRows) {
    const stationId = r.parent_station && r.parent_station.length > 0 ? r.parent_station : r.stop_id;
    childToStation.set(r.stop_id, stationId);
  }
  const stationIds = new Set(childToStation.values());
  const stationMeta = new Map<string, { name: string; lat: number; lon: number }>();
  for (const sid of stationIds) {
    const row = rowsById.get(sid);
    if (row) {
      stationMeta.set(sid, { name: row.stop_name, lat: Number(row.stop_lat), lon: Number(row.stop_lon) });
    } else {
      console.warn(`[gtfs] station id ${sid} referenced as a parent_station but has no own stops.txt row — skipping`);
    }
  }
  console.log(`[gtfs] ${stationMeta.size} station complexes`);

  // transfers.txt links station complexes that sit at the same physical
  // "station" in rider terms but are separate GTFS parent_station ids
  // (MTA's feed assigns a distinct complex id per original IRT/BMT/IND
  // facility even where they're connected — e.g. Times Sq-42 St is FOUR
  // separate complex ids: 1/2/3, the 7, the shuttle, and A/C/E). Without
  // these, the graph fragments into disconnected per-trunk-line islands,
  // which is wrong — these are real, walkable, free in-system transfers.
  // Cross-complex rows (from_stop_id !== to_stop_id) get turned into
  // transfer edges below, weighted by the feed's own min_transfer_time
  // rather than the flat same-station penalty.
  const transferRows = parseCsv(readEntry("transfers.txt"));
  const crossComplexTransfers: { a: string; b: string; minutes: number }[] = [];
  const seenPair = new Set<string>();
  for (const r of transferRows) {
    const a = childToStation.get(r.from_stop_id) ?? r.from_stop_id;
    const b = childToStation.get(r.to_stop_id) ?? r.to_stop_id;
    if (a === b) continue;
    if (!stationMeta.has(a) || !stationMeta.has(b)) continue;
    const [x, y] = [a, b].sort();
    const pairKey = `${x}|${y}`;
    if (seenPair.has(pairKey)) continue;
    seenPair.add(pairKey);
    const seconds = Number(r.min_transfer_time || "300");
    const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : 5;
    crossComplexTransfers.push({ a: x, b: y, minutes });
  }
  console.log(`[gtfs] ${crossComplexTransfers.length} cross-complex transfer links from transfers.txt`);

  console.log("[gtfs] streaming stop_times.txt (weekday trips only)...");
  const stopTimesText = readEntry("stop_times.txt");
  const stationLines = new Map<string, Set<string>>();
  const edgeAccumulators = new Map<string, EdgeAccumulator>(); // key: "<stationA>|<stationB>|<line>" with A<B lexicographically

  const addLine = (stationId: string, line: string): void => {
    let set = stationLines.get(stationId);
    if (!set) {
      set = new Set();
      stationLines.set(stationId, set);
    }
    set.add(line);
  };

  let processedTrips = 0;
  const processTripBlock = (tripId: string, rows: { stop_id: string; stop_sequence: string; arrival_time: string; departure_time: string }[]): void => {
    const routeId = routeIdByTripId.get(tripId);
    if (!routeId) return;
    const shortName = routeShortNameById.get(routeId);
    if (!shortName) return;
    const lineId = normalizeLineId(shortName);
    if (!lineId) return;

    const sorted = [...rows].sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    for (const r of sorted) {
      const stationId = childToStation.get(r.stop_id);
      if (stationId && stationMeta.has(stationId)) addLine(stationId, lineId);
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const fromStationId = childToStation.get(sorted[i].stop_id);
      const toStationId = childToStation.get(sorted[i + 1].stop_id);
      if (!fromStationId || !toStationId || fromStationId === toStationId) continue;
      if (!stationMeta.has(fromStationId) || !stationMeta.has(toStationId)) continue;
      const depSec = parseGtfsTimeSeconds(sorted[i].departure_time);
      const arrSec = parseGtfsTimeSeconds(sorted[i + 1].arrival_time);
      const durationMin = (arrSec - depSec) / 60;
      if (!(durationMin > 0) || durationMin > 60) continue; // guard against bad/duplicate timestamps
      const [a, b] = [fromStationId, toStationId].sort();
      const key = `${a}|${b}|${lineId}`;
      const acc = edgeAccumulators.get(key);
      if (acc) {
        acc.sumMinutes += durationMin;
        acc.count += 1;
      } else {
        edgeAccumulators.set(key, { sumMinutes: durationMin, count: 1 });
      }
    }
    processedTrips++;
  };

  let buffer: { stop_id: string; stop_sequence: string; arrival_time: string; departure_time: string }[] = [];
  let currentTripId: string | null = null;
  const flush = (): void => {
    if (currentTripId && buffer.length >= 2) processTripBlock(currentTripId, buffer);
    buffer = [];
  };
  forEachCsvLine(stopTimesText, (row) => {
    if (row.trip_id !== currentTripId) {
      flush();
      currentTripId = row.trip_id;
    }
    if (weekdayTripIds.has(row.trip_id)) {
      buffer.push({
        stop_id: row.stop_id,
        stop_sequence: row.stop_sequence,
        arrival_time: row.arrival_time,
        departure_time: row.departure_time,
      });
    }
  });
  flush();
  console.log(`[gtfs] processed ${processedTrips} weekday trips, ${edgeAccumulators.size} distinct (station,station,line) segments`);

  // ---- ADA equipment -------------------------------------------------
  console.log("[gtfs] fetching MTA elevator/escalator equipment dataset for ADA flags...");
  const adaPoints = await fetchAdaElevators();
  const inServiceAdaPoints = adaPoints.filter((p) => p.inService);
  if (adaPoints.length === 0) {
    console.warn("[gtfs] ADA equipment dataset unreachable/empty — every station will be written with ada:false.");
  } else {
    console.log(`[gtfs] ${inServiceAdaPoints.length} in-service elevators loaded for ADA matching`);
  }
  const isAdaStation = (p: LatLon): boolean =>
    inServiceAdaPoints.some((e) => haversineMeters(p, e) <= ADA_MATCH_RADIUS_M);

  // ---- Build Station[] -------------------------------------------------
  const lineOrder = new Map(ALL_LINES.map((l, i) => [l, i]));
  const stationList: Station[] = [];
  for (const [id, meta] of stationMeta) {
    const lines = Array.from(stationLines.get(id) ?? []).sort(
      (x, y) => (lineOrder.get(x as LineId) ?? 999) - (lineOrder.get(y as LineId) ?? 999),
    );
    if (lines.length === 0) continue; // no weekday service observed at this stop id — likely non-revenue/unused in current schedule
    const point = { lat: meta.lat, lon: meta.lon };
    const station: Station = {
      id,
      name: meta.name,
      lat: meta.lat,
      lon: meta.lon,
      borough: boroughForPoint(point),
      lines,
      ada: isAdaStation(point),
    };
    stationList.push(StationSchema.parse(station));
  }
  stationList.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`[gtfs] ${stationList.length} stations with weekday service`);

  // ---- Build expanded (station,line) graph + Dijkstra ------------------
  interface Edge {
    to: string;
    weight: number;
    isTransfer: boolean;
    line: string;
  }
  const adjacency = new Map<string, Edge[]>();
  const addEdge = (from: string, to: string, weight: number, isTransfer: boolean, line: string): void => {
    let list = adjacency.get(from);
    if (!list) {
      list = [];
      adjacency.set(from, list);
    }
    list.push({ to, weight, isTransfer, line });
  };
  const nodeKey = (stationId: string, line: string): string => `${stationId}::${line}`;

  for (const [key, acc] of edgeAccumulators) {
    const [a, b, line] = key.split("|");
    const avg = acc.sumMinutes / acc.count;
    addEdge(nodeKey(a, line), nodeKey(b, line), avg, false, line);
    addEdge(nodeKey(b, line), nodeKey(a, line), avg, false, line);
  }
  for (const station of stationList) {
    for (let i = 0; i < station.lines.length; i++) {
      for (let j = 0; j < station.lines.length; j++) {
        if (i === j) continue;
        addEdge(nodeKey(station.id, station.lines[i]), nodeKey(station.id, station.lines[j]), TRANSFER_PENALTY_MIN, true, station.lines[j]);
      }
    }
  }

  const stationById = new Map(stationList.map((s) => [s.id, s]));
  for (const { a, b, minutes } of crossComplexTransfers) {
    const stationA = stationById.get(a);
    const stationB = stationById.get(b);
    if (!stationA || !stationB) continue;
    for (const lineA of stationA.lines) {
      for (const lineB of stationB.lines) {
        addEdge(nodeKey(a, lineA), nodeKey(b, lineB), minutes, true, lineB);
        addEdge(nodeKey(b, lineB), nodeKey(a, lineA), minutes, true, lineA);
      }
    }
  }

  const allNodes = Array.from(new Set(stationList.flatMap((s) => s.lines.map((l) => nodeKey(s.id, l)))));
  const nodeIndex = new Map(allNodes.map((n, i) => [n, i]));
  console.log(`[gtfs] expanded (station,line) graph: ${allNodes.length} nodes`);

  interface PathResult {
    minutes: number;
    transfers: number;
    viaLine: string;
  }

  function dijkstraFrom(sourceStationId: string): Map<string, PathResult> {
    const sourceStation = stationList.find((s) => s.id === sourceStationId);
    if (!sourceStation) return new Map();
    const dist = new Float64Array(allNodes.length).fill(Infinity);
    const visited = new Uint8Array(allNodes.length);
    const prevNode: number[] = new Array(allNodes.length).fill(-1);
    const prevIsTransfer: boolean[] = new Array(allNodes.length).fill(false);
    const prevLine: (string | null)[] = new Array(allNodes.length).fill(null);

    for (const line of sourceStation.lines) {
      const idx = nodeIndex.get(nodeKey(sourceStationId, line));
      if (idx !== undefined) dist[idx] = 0;
    }

    for (let iter = 0; iter < allNodes.length; iter++) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < allNodes.length; i++) {
        if (!visited[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u === -1) break; // remaining nodes unreachable
      visited[u] = 1;
      const edges = adjacency.get(allNodes[u]);
      if (!edges) continue;
      for (const e of edges) {
        const v = nodeIndex.get(e.to);
        if (v === undefined || visited[v]) continue;
        const alt = dist[u] + e.weight;
        if (alt < dist[v]) {
          dist[v] = alt;
          prevNode[v] = u;
          prevIsTransfer[v] = e.isTransfer;
          prevLine[v] = e.line;
        }
      }
    }

    // For each target station, take the best-reachable line-node and
    // reconstruct the path to get transfer count + dominant line.
    const results = new Map<string, PathResult>();
    for (const station of stationList) {
      if (station.id === sourceStationId) continue;
      let bestIdx = -1;
      let bestDist = Infinity;
      for (const line of station.lines) {
        const idx = nodeIndex.get(nodeKey(station.id, line));
        if (idx !== undefined && dist[idx] < bestDist) {
          bestDist = dist[idx];
          bestIdx = idx;
        }
      }
      if (bestIdx === -1 || !Number.isFinite(bestDist)) continue; // unreachable (e.g. Staten Island Railway)

      let transfers = 0;
      const rideMinutesByLine = new Map<string, number>();
      let cursor = bestIdx;
      while (prevNode[cursor] !== -1) {
        const from = prevNode[cursor];
        const line = prevLine[cursor] as string;
        const edgeWeight = dist[cursor] - dist[from];
        if (prevIsTransfer[cursor]) {
          transfers++;
        } else {
          rideMinutesByLine.set(line, (rideMinutesByLine.get(line) ?? 0) + edgeWeight);
        }
        cursor = from;
      }
      let viaLine = station.lines[0];
      let viaLineMax = -1;
      for (const [line, minutes] of rideMinutesByLine) {
        if (minutes > viaLineMax) {
          viaLineMax = minutes;
          viaLine = line;
        }
      }
      results.set(station.id, { minutes: Math.round(bestDist), transfers, viaLine });
    }
    return results;
  }

  console.log("[gtfs] computing all-pairs shortest paths (this takes a bit)...");
  const travelTimes: { from: string; to: string; minutes: number; transfers: number; viaLine: string }[] = [];
  const sortedStationIds = stationList.map((s) => s.id); // already sorted above
  const stationIndexOrder = new Map(sortedStationIds.map((id, i) => [id, i]));
  for (let i = 0; i < stationList.length; i++) {
    const results = dijkstraFrom(stationList[i].id);
    for (const [toId, r] of results) {
      const toIdx = stationIndexOrder.get(toId) ?? -1;
      if (toIdx <= i) continue; // one direction per unordered pair only
      travelTimes.push({ from: stationList[i].id, to: toId, minutes: r.minutes, transfers: r.transfers, viaLine: r.viaLine });
    }
    if (i % 50 === 0) console.log(`[gtfs]   ...${i}/${stationList.length} sources done`);
  }
  console.log(`[gtfs] ${travelTimes.length} unordered station pairs with a computed path`);

  // ---- Write data/gtfs/station-matrix.json ------------------------------
  const outDir = path.join(process.cwd(), "data", "gtfs");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "station-matrix.json");
  await writeFile(outPath, JSON.stringify({ stations: stationList, travelTimes }, null, 2));
  console.log(`[gtfs] wrote ${outPath}`);

  // ---- Populate SQLite via Drizzle --------------------------------------
  console.log("[gtfs] writing to data/derive.sqlite (stations, station_travel_times)...");
  db.transaction((tx) => {
    tx.delete(stationTravelTimes).run();
    tx.delete(stationsTable).run();
    const stationRows = stationList.map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      borough: s.borough,
      linesJson: JSON.stringify(s.lines),
      ada: s.ada,
    }));
    for (let i = 0; i < stationRows.length; i += 200) {
      tx.insert(stationsTable).values(stationRows.slice(i, i + 200)).run();
    }
    for (let i = 0; i < travelTimes.length; i += 400) {
      const chunk = travelTimes.slice(i, i + 400).map((t) => ({
        fromStationId: t.from,
        toStationId: t.to,
        minutes: t.minutes,
        transfers: t.transfers,
        viaLine: t.viaLine,
      }));
      tx.insert(stationTravelTimes).values(chunk).run();
    }
  });
  console.log(`[gtfs] done — ${stationList.length} stations, ${travelTimes.length} travel-time pairs`);
}

main().catch((err) => {
  console.error("[gtfs] fatal:", err);
  process.exit(1);
});
