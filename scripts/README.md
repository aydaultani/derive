# DERIVE data pipeline

Three scripts, run in this order, each writing a committed snapshot under
`data/` plus the matching table(s) in `data/derive.sqlite`:

## 1. `pnpm ingest:gtfs` (`scripts/build-station-matrix.ts`)

Downloads the MTA GTFS static feed
(`https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip`, no key needed),
parses `stops.txt` / `routes.txt` / `trips.txt` / `stop_times.txt`,
collapses child stops into ~470 parent station complexes, and builds a
station graph using average scheduled travel time between consecutive
stops on the same trip (a one-time precompute, not live routing — see the
in-file comment for why this simplification is fine at this scale). Runs
all-pairs shortest paths to produce `minutes` / `transfers` / `viaLine`
for every station pair, and pulls the MTA's published elevator/escalator
equipment dataset for the `ada` (step-free) flag.

Writes `data/gtfs/station-matrix.json` (shape pinned in `CONTRACT.md`) and
populates the `stations` + `station_travel_times` tables.

## 2. `pnpm ingest:places` (`scripts/ingest-places.ts`)

Pulls real OSM data via the Overpass API for `tourism`, `historic`,
`amenity`, `leisure`, `natural`, `shop`, and transit-oddity `railway`
values, across curated per-borough bounding-box queries plus a handful of
deliberately-included far-out neighborhoods (Rockaway, City Island, Broad
Channel, Tottenville, ...) so Legendary-tier material exists. Filters out
tag-sparse garbage (`scripts/lib/quality.ts`), derives `category`,
`borough`, `budgetTier`, `indoor`, and snaps each place to its nearest
station (`nearestStationId` / `walkMinutesToStation`, via
`src/lib/station-matrix.ts` — **requires step 1 to have already run**).

Writes `data/osm/places.json` and populates the `places` table. Targets
roughly 800–2500 quality-passing places; the committed snapshot has 2,200
across all five boroughs.

Overpass endpoint defaults to `https://overpass-api.de/api/interpreter`
with a fallback mirror on repeated failure — see `OVERPASS_API_URL` in
`.env.example`. Sends a descriptive `User-Agent` per Overpass/Nominatim
usage policy.

## 3. `pnpm generate:cards` (`scripts/generate-cards.ts`)

For every place in `data/osm/places.json`, produces card copy (`name`,
`reason`, `dare`, `timeWindow`) and caches it in `card_copy_cache` so a
spin never makes a live model call. If `ANTHROPIC_API_KEY` is set, calls
the Anthropic API; otherwise (the default — DERIVE ships with zero
required keys) uses a template-based fallback generator, varied by
category, with deterministic per-place selection so re-runs are
idempotent. This fallback path is what's actually committed to
`data/derive.sqlite`.

## Refreshing the data

Re-running any script overwrites its output snapshot and upserts into
`data/derive.sqlite`. To refresh everything from scratch:

```bash
rm -f data/derive.sqlite
pnpm db:push
pnpm ingest:gtfs
pnpm ingest:places
pnpm generate:cards
```

`pnpm db:push` (drizzle-kit) materializes the schema from
`src/db/schema.ts` into a fresh sqlite file before any script writes to
it.
