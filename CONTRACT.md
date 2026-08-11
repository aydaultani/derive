# DERIVE — build contract

Shared reference for every track. Types live in `src/lib/schemas.ts` (Zod,
runtime-validated) and `src/db/schema.ts` (Drizzle, storage shape). MTA line
colors live in `src/lib/mta-lines.ts`. **Don't redeclare these shapes
elsewhere — import them.**

## Rarity algorithm (derived, not assigned)

For every place in the *filtered* candidate pool, compute a rarity **score**
in `src/lib/rarity.ts`:

```
score = 0.45 * norm(travelMinutes)
      + 0.35 * (1 - norm(tagCount))
      + 0.20 * norm(touristDistanceM)
```

`norm()` min-max normalizes across the current pool (not global), so rarity
is always relative to what the filters left standing — a place nobody has
reviewed is rarer than the High Line because it has fewer OSM tags and sits
further from the tourist-attraction centroid, not because of a hardcoded
list.

**Roll**, given the scored pool:
1. Sort the pool by score ascending, bucket into five percentile groups
   sized to match `RARITY_WEIGHTS` from `src/lib/schemas.ts` (55/27/13/4.5/0.5).
2. Seed a PRNG (mulberry32) from `sha256(userId + ":" + dealtDate)`.
3. Draw #1: pick a tier via weighted random using `RARITY_WEIGHTS` — this is
   what the 100k-roll distribution test asserts against tolerance.
4. Draw #2: pick uniformly within that tier's bucket.
5. If a bucket is empty (tiny filtered pool), fall back to the nearest
   non-empty tier below it and note this in the response — this is also
   the trigger for the "pool below ~40 places" filter warning upstream.

Both draws must come from the same seeded PRNG in a fixed order so a given
`(userId, dealtDate)` always reproduces the same card — refreshing the page
must never reroll.

## Daily lock

`cards` has a unique constraint on `(userId, dealtDate)`. Spin flow:
1. Client sends IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
2. Server computes `dealtDate` = today's date in that timezone (YYYY-MM-DD).
3. `SELECT` existing card for `(userId, dealtDate)` — if found, return it
   (locked; this is not a reroll path).
4. If not found, run the roll, `INSERT`, return it.
5. A card is "expired" once `now > local midnight ending dealtDate` and
   `status` is still `locked` — compute this lazily on read, don't cron it.

## Design tokens (already in `src/app/globals.css`)

- `--line-*` — MTA line hex colors, one card tint per `viaLine`.
- `--dither-{tier}` — density 0–1 per rarity tier, used by the ASCII dither
  field. Common is sparse `░`, legendary is dense `▓`. No glow/gradients.
- `.font-display` (Instrument Serif) for card names only. Everything
  structural (times, station codes, coordinates, filter labels) stays in
  `.chrome` (IBM Plex Mono, uppercase, tracked out) — the whole body font
  is mono by default.
- `--reveal-duration` collapses to 0ms under `prefers-reduced-motion`.

## ASCII wireframes

### Card reveal (mobile, ~390px)

```
┌──────────────────────────────────┐
│ DERIVE            [====------] ⋮ │  <- chrome: streak dots, menu
├──────────────────────────────────┤
│                                    │
│   ▓▓▓▓▓▓░░░░▓▓▓▓░░░▓▓▓░░░░▓▓▓▓    │
│   ░▓▓▓░░▓▓▓▓▓▓░░▓▓▓▓░░▓▓░░░▓▓▓    │  <- dither field, density = rarity
│   ▓▓░░▓▓▓▓░░▓▓▓▓░░▓▓▓▓▓░░▓▓░░▓    │     (resolves first, ~1200ms)
│   ░▓▓▓▓░░▓▓▓░░▓▓▓▓░░▓▓░░▓▓▓▓░░    │
│                                    │
│         ██████████                │  <- line-color bleed-in (~800ms)
│                                    │
│      Broad Channel                │  <- .font-display, name sets last
│      LEGENDARY                    │  <- .chrome, tinted by viaLine
│                                    │
│  A TRAIN · 52 MIN · 1 TRANSFER    │  <- .chrome, mono
│  40.6083, -73.8206                │
│                                    │
│  "Stand on the platform until a   │  <- reason, one line
│   train crosses the marsh."       │
│                                    │
│  DARE                              │
│  Photograph the tide from the      │  <- dare, imperative, terse
│  footbridge before you leave.      │
│                                    │
│  ┌──────────────────────────────┐ │
│  │        I WENT →              │ │  <- proof entry point
│  └──────────────────────────────┘ │
│                                    │
│  Expires 11:59 PM                  │  <- terse, signage-register copy
└──────────────────────────────────┘
```

Sequence (3s total, cut-to-final under reduced motion): dither field
resolves from noise → line color bleeds in behind the name plate → name
and copy set. One spin, once a day.

### Collection grid (mobile, ~390px)

```
┌──────────────────────────────────┐
│ DERIVE / COLLECTION      41 / 812 │  <- .chrome counter, most-screenshot
├──────────────────────────────────┤
│ [ALL] [COMMON] [RARE+] [MINE]     │  <- tier filter chips
├──────────────────────────────────┤
│  ▓▓  ░░  ██  ░░  ▓▓  ░░  ██  ░░   │
│  ░░  ▓▓  ░░  ░░  ██  ░░  ▓▓  ░░   │  <- lit cells = completed, tinted
│  ░░  ░░  ░░  ██  ░░  ░░  ░░  ▓▓   │     by viaLine; greyed = undealt/
│  ██  ░░  ░░  ░░  ░░  ██  ░░  ░░   │     un-completed, dither ghosted
│  ░░  ░░  ▓▓  ░░  ░░  ░░  ░░  ░░   │     at low opacity, no color
│  ...                               │
├──────────────────────────────────┤
│  Tap a lit card for the story.     │
│  Greyed cards are still locked.    │
└──────────────────────────────────┘
```

Honor-system completions render with a dotted border instead of a solid
one — same tint, visibly different provenance, never hidden.

## Cross-track function signatures (pin these — don't rename)

Different tracks are built in parallel worktrees without talking to each
other. These signatures are the seams. Implement exactly these; the
integration pass wires them together.

```ts
// src/lib/rarity.ts
export interface RollResult { place: Place; tier: RarityTier; score: number }
export function scorePlace(place: Place, pool: Place[]): number;
export function rollCard(pool: Place[], userId: string, dealtDate: string): RollResult;

// src/lib/geocode.ts
export interface GeocodeResult { lat: number; lon: number; label: string }
export function geocodeOrigin(query: string): Promise<GeocodeResult | null>;

// src/lib/station-matrix.ts
export function loadStationMatrix(): void; // reads data/gtfs/station-matrix.json into memory once
export function nearestStation(lat: number, lon: number): { station: Station; walkMinutes: number } | null;
export function travelBetween(fromStationId: string, toStationId: string): { minutes: number; transfers: number; viaLine: string } | null;

// src/lib/query-builder.ts
export function buildPlaceQuery(filters: Filters): { sql: string; params: unknown[] } | ReturnType<typeof import("drizzle-orm").sql>;
// Must translate every Filters field into a real SQL predicate against
// `places`/`stations` — no post-query array filtering. "openNow" may do a
// coarse SQL narrow (has openingHoursRaw) then precise JS evaluation on
// the narrowed rows using the `opening_hours` npm package.
```

## File ownership (parallel worktree tracks)

To keep merges clean, each track only touches these paths:

- **data-pipeline**: `scripts/ingest-places.ts`, `scripts/build-station-matrix.ts`,
  `scripts/generate-cards.ts`, `scripts/config/rarity-weights.ts`,
  `scripts/lib/**`, `data/**`, `src/lib/station-matrix.ts`
- **rarity-engine**: `src/lib/rarity.ts`, `src/lib/rarity.test.ts`,
  `src/lib/seeded-random.ts`
- **spin-api**: `src/lib/geocode.ts`, `src/lib/spin.ts`, `src/lib/spin.test.ts`,
  `src/app/api/spin/route.ts`, `src/lib/local-date.ts`
- **ui-core**: `src/app/page.tsx`, `src/components/spin/**`,
  `src/components/ui/**`, `src/lib/local-user.ts`
- **filters-collection**: `src/lib/query-builder.ts`,
  `src/components/filters/**`, `src/components/collection/**`,
  `src/app/collection/page.tsx`, `src/app/api/proof/route.ts`,
  `src/app/api/places/route.ts`

Shared, read-only for everyone: `src/lib/schemas.ts`, `src/db/schema.ts`,
`src/db/client.ts`, `src/lib/mta-lines.ts`, `src/app/globals.css`. If a
track needs a change there, it should say so in its final report instead
of editing it, so the integration pass applies it once.

## Committed data file shapes (agree on these without a shared file yet)

`data/gtfs/station-matrix.json` (produced by data-pipeline, consumed by
spin-api's `loadStationMatrix()`):

```json
{
  "stations": [
    { "id": "A24", "name": "Broad Channel", "lat": 40.608, "lon": -73.8206, "borough": "queens", "lines": ["A", "S"], "ada": false }
  ],
  "travelTimes": [
    { "from": "A24", "to": "127", "minutes": 52, "transfers": 1, "viaLine": "A" }
  ]
}
```
`travelTimes` only needs one direction per unordered pair; treat it as
symmetric at lookup time. Every station in `travelTimes` must appear in
`stations`.

`data/osm/places.json` (produced by data-pipeline, loaded into the
`places` table by `scripts/ingest-places.ts` itself — it should both
write this snapshot AND populate `data/derive.sqlite` in the same run):
an array of objects matching `Place` from `src/lib/schemas.ts` exactly.

If you're not the data-pipeline track, write a small fixture file at
`data/gtfs/station-matrix.sample.json` / `data/osm/places.sample.json`
(3-5 entries, real NYC places/stations, shape-correct) so your own tests
and manual runs work before the real snapshot lands — the integration
pass will point everything at the real files once merged.
