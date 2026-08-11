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
