/**
 * scripts/ingest-places.ts
 *
 * Pulls real OSM data via the Overpass API, scoped to NYC's five boroughs
 * plus a handful of deliberately-included far-out neighborhoods, filters
 * out tag-sparse garbage, derives every Place field per CONTRACT.md, and
 * writes both data/osm/places.json and the `places` table in
 * data/derive.sqlite. Real network calls, no mocking — see
 * scripts/README.md to re-run. Requires data/gtfs/station-matrix.json to
 * already exist (run scripts/build-station-matrix.ts first) since
 * nearestStationId/walkMinutesToStation come from it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/db/client";
import { places as placesTable } from "../src/db/schema";
import { PlaceSchema, BOROUGHS, type Place } from "../src/lib/schemas";
import { loadStationMatrix, nearestStation } from "../src/lib/station-matrix";
import { runOverpassQuery, type OverpassElement } from "./lib/overpass";
import { buildBoroughQuery, buildAroundQuery } from "./lib/overpass-queries";
import { BOROUGH_BBOXES, FAR_OUT_SPOTS, boroughForPoint } from "./lib/nyc-geo";
import { passesQualityFilter, qualityScore } from "./lib/quality";
import { deriveCategory } from "./lib/category-map";
import { deriveBudgetTier, deriveIndoor, deriveAddress, deriveStepFreeOk } from "./lib/derive-fields";
import { centroid, haversineMeters, type LatLon } from "./lib/geo";
import { seededShuffle } from "./lib/deterministic-shuffle";

// "Roughly 800-2500 quality-passing places spread across all five
// boroughs and across the rarity spectrum" per the task brief.
const TARGET_MAX_PLACES = 2200;
const TARGET_MIN_PLACES = 800;
const POLITE_DELAY_MS = 5000; // be a good Overpass citizen between sequential queries

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elementPoint(el: OverpassElement): LatLon | null {
  if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lon: el.lon };
  }
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
}

interface Candidate {
  place: Place;
  isFarOut: boolean;
}

/**
 * If the quality-passing pool exceeds TARGET_MAX_PLACES, downsample it
 * deterministically. Far-out-sourced places are always kept in full (that's
 * the whole point of pulling them — Legendary tier needs real material).
 * The rest is stratified by (borough, category) and round-robin sampled so
 * the cut doesn't quietly gut a whole borough or category.
 */
function downsample(candidates: Candidate[], targetMax: number): Place[] {
  const mustKeep = candidates.filter((c) => c.isFarOut).map((c) => c.place);
  const pool = candidates.filter((c) => !c.isFarOut).map((c) => c.place);

  if (mustKeep.length + pool.length <= targetMax) {
    return dedupeById([...mustKeep, ...pool]);
  }

  const remaining = Math.max(targetMax - mustKeep.length, 0);
  const buckets = new Map<string, Place[]>();
  for (const p of pool) {
    const key = `${p.borough}|${p.category}`;
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(p);
  }
  for (const [key, arr] of buckets) buckets.set(key, seededShuffle(arr, `derive-ingest-bucket-${key}`));
  const bucketKeys = seededShuffle(Array.from(buckets.keys()), "derive-ingest-bucket-order");

  const picked: Place[] = [];
  let cursor = 0;
  while (picked.length < remaining) {
    let addedAny = false;
    for (const key of bucketKeys) {
      if (picked.length >= remaining) break;
      const arr = buckets.get(key);
      if (arr && cursor < arr.length) {
        picked.push(arr[cursor]);
        addedAny = true;
      }
    }
    cursor++;
    if (!addedAny) break; // every bucket exhausted before hitting target
  }
  return dedupeById([...mustKeep, ...picked]);
}

function dedupeById(placesArr: Place[]): Place[] {
  const map = new Map<string, Place>();
  for (const p of placesArr) map.set(p.id, p);
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function logBreakdown(placesArr: Place[]): void {
  const byBorough = new Map<string, number>();
  const byCategory = new Map<string, number>();
  for (const p of placesArr) {
    byBorough.set(p.borough, (byBorough.get(p.borough) ?? 0) + 1);
    byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  }
  console.log("[ingest] borough breakdown:", Object.fromEntries(byBorough));
  console.log("[ingest] category breakdown:", Object.fromEntries(byCategory));
}

interface FetchedElement {
  el: OverpassElement;
  isFarOut: boolean;
}

async function main(): Promise<void> {
  console.log("[ingest] loading station matrix (run scripts/build-station-matrix.ts first if this is empty)...");
  loadStationMatrix();

  const rawByKey = new Map<string, FetchedElement>();

  for (const borough of BOROUGHS) {
    console.log(`[ingest] fetching borough ${borough}...`);
    const query = buildBoroughQuery(BOROUGH_BBOXES[borough]);
    let elements = await runOverpassQuery(query, `borough:${borough}`);
    if (elements.length === 0) {
      // Boroughs are load-bearing (unlike the far-out boost queries) — the
      // servers were visibly under transient load during testing (a mix
      // of 429s and 504s across both primary and the mirror), so worth
      // one extra longer-backoff pass rather than shipping a borough with
      // near-zero coverage.
      console.warn(`[ingest] ${borough} came back empty — waiting 20s and retrying once more before moving on...`);
      await sleep(20000);
      elements = await runOverpassQuery(query, `borough:${borough}:retry`);
    }
    console.log(`[ingest]   -> ${elements.length} raw elements`);
    for (const el of elements) {
      const key = `${el.type}/${el.id}`;
      if (!rawByKey.has(key)) rawByKey.set(key, { el, isFarOut: false });
    }
    await sleep(POLITE_DELAY_MS);
  }

  for (const spot of FAR_OUT_SPOTS) {
    console.log(`[ingest] fetching far-out spot: ${spot.label}...`);
    const query = buildAroundQuery(spot.lat, spot.lon, spot.radiusM);
    const elements = await runOverpassQuery(query, `farout:${spot.label}`);
    console.log(`[ingest]   -> ${elements.length} raw elements`);
    for (const el of elements) {
      const key = `${el.type}/${el.id}`;
      const existing = rawByKey.get(key);
      if (existing) {
        existing.isFarOut = true;
      } else {
        rawByKey.set(key, { el, isFarOut: true });
      }
    }
    await sleep(POLITE_DELAY_MS);
  }

  console.log(`[ingest] ${rawByKey.size} unique raw OSM elements pulled total`);

  // touristDistanceM: haversine distance to the centroid of every
  // tourism=attraction node/way in the pulled corpus (not just the
  // quality-passing subset — more points makes for a more stable centroid).
  const attractionPoints: LatLon[] = [];
  for (const { el } of rawByKey.values()) {
    if (el.tags?.tourism === "attraction") {
      const point = elementPoint(el);
      if (point) attractionPoints.push(point);
    }
  }
  const touristCentroid = centroid(attractionPoints);
  console.log(
    touristCentroid
      ? `[ingest] tourist-attraction centroid from ${attractionPoints.length} nodes: ${touristCentroid.lat.toFixed(4)}, ${touristCentroid.lon.toFixed(4)}`
      : "[ingest] WARNING: no tourism=attraction nodes found in the pulled corpus — touristDistanceM will be 0 for every place",
  );

  const candidates: Candidate[] = [];
  let rejectedNoName = 0;
  let rejectedLowQuality = 0;
  let rejectedNoCoords = 0;

  for (const { el, isFarOut } of rawByKey.values()) {
    const point = elementPoint(el);
    if (!point) {
      rejectedNoCoords++;
      continue;
    }
    const tags = el.tags ?? {};
    const name = tags.name;
    if (!passesQualityFilter({ name, tags })) {
      if (!name || !name.trim()) rejectedNoName++;
      else rejectedLowQuality++;
      continue;
    }

    const category = deriveCategory(tags);
    const borough = boroughForPoint(point);
    const nearest = nearestStation(point.lat, point.lon);
    if (!nearest) continue; // station matrix should always have stations; guards against an empty/corrupt matrix file
    const touristDistanceM = touristCentroid ? haversineMeters(point, touristCentroid) : 0;

    const place = PlaceSchema.parse({
      id: `${el.type}/${el.id}`,
      osmId: String(el.id),
      osmType: el.type,
      name: name.trim(),
      lat: point.lat,
      lon: point.lon,
      borough,
      category,
      tags,
      tagCount: Object.keys(tags).length,
      address: deriveAddress(tags),
      openingHoursRaw: tags.opening_hours ?? null,
      budgetTier: deriveBudgetTier(tags, category),
      indoor: deriveIndoor(tags),
      nearestStationId: nearest.station.id,
      walkMinutesToStation: nearest.walkMinutes,
      stepFreeOk: deriveStepFreeOk(tags),
      touristDistanceM,
      qualityScore: qualityScore(tags),
    } satisfies Place);

    candidates.push({ place, isFarOut });
  }

  console.log(
    `[ingest] ${candidates.length} places passed the quality filter (rejected: ${rejectedNoName} no name, ${rejectedLowQuality} low quality, ${rejectedNoCoords} no coordinates)`,
  );

  const finalPlaces = downsample(candidates, TARGET_MAX_PLACES);
  if (finalPlaces.length < TARGET_MIN_PLACES) {
    console.warn(
      `[ingest] WARNING: only ${finalPlaces.length} places, below the ${TARGET_MIN_PLACES} target floor. Shipping what we have — see scripts/README.md for how to widen the query if you want more.`,
    );
  }
  console.log(`[ingest] ${finalPlaces.length} places in the final ingest`);
  logBreakdown(finalPlaces);

  const outDir = path.join(process.cwd(), "data", "osm");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "places.json");
  await writeFile(outPath, JSON.stringify(finalPlaces, null, 2));
  console.log(`[ingest] wrote ${outPath}`);

  console.log("[ingest] writing to data/derive.sqlite (places)...");
  const nowIso = new Date().toISOString();
  db.transaction((tx) => {
    tx.delete(placesTable).run();
    const rows = finalPlaces.map((p) => ({
      id: p.id,
      osmId: p.osmId,
      osmType: p.osmType,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      borough: p.borough,
      category: p.category,
      tagsJson: JSON.stringify(p.tags),
      tagCount: p.tagCount,
      address: p.address,
      openingHoursRaw: p.openingHoursRaw,
      budgetTier: p.budgetTier,
      indoor: p.indoor,
      nearestStationId: p.nearestStationId,
      walkMinutesToStation: p.walkMinutesToStation,
      stepFreeOk: p.stepFreeOk,
      touristDistanceM: p.touristDistanceM,
      qualityScore: p.qualityScore,
      sourceUpdatedAt: nowIso,
    }));
    for (let i = 0; i < rows.length; i += 300) {
      tx.insert(placesTable).values(rows.slice(i, i + 300)).run();
    }
  });
  console.log(`[ingest] done — ${finalPlaces.length} places written to JSON + SQLite`);
}

main().catch((err) => {
  console.error("[ingest] fatal:", err);
  process.exit(1);
});
