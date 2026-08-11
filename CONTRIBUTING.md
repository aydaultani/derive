# Contributing to DERIVE

## Setup

```bash
pnpm install
pnpm dev
```

No API keys required — the committed seed data (`data/derive.sqlite` and
its `data/osm/`, `data/gtfs/` source snapshots) is enough for a fully
working app.

## Before opening a PR

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

All four should pass clean. TypeScript is strict — no `any`, no
unchecked casts. Every request/response and database boundary is
validated with Zod (`src/lib/schemas.ts`); reuse those schemas rather
than redeclaring shapes.

## Where things live

- `src/lib/schemas.ts` — the Zod contract for every domain type (`Place`,
  `Card`, `Filters`, API request/response shapes). Start here.
- `src/db/schema.ts` — the Drizzle storage shape, mirrors `schemas.ts`.
- `src/lib/rarity.ts` — the rarity scoring/roll algorithm.
- `src/lib/spin.ts` — the daily-lock spin orchestration.
- `src/lib/query-builder.ts` — filters → SQL.
- `src/lib/mta-lines.ts` — the MTA line color tokens.
- `src/app/globals.css` — design tokens (colors, type scale, dither
  density).
- `scripts/` — the data pipeline (OSM ingest, GTFS matrix build, card
  copy generation). See `scripts/README.md` for how to re-run each one.
- `CONTRACT.md` — the fuller design/architecture reference: rarity
  algorithm detail, ASCII wireframes, the daily-lock spec.

## Conventions

- **Tunable weights stay in one place.** Rarity tier weights live in
  `RARITY_WEIGHTS` (`src/lib/schemas.ts`) — don't hardcode a percentage
  anywhere else.
- **Filters must be real SQL predicates**, not `.filter()` over an
  already-fetched array — see the exceptions and reasoning documented at
  the top of `src/lib/query-builder.ts` (rarity floor and max-travel-time
  are the two deliberate, documented exceptions; both are origin- or
  roll-dependent and can't be pushed into SQL).
- **Copy is terse and declarative**, signage register — "Card dealt.",
  "Expires 11:59 PM.", not exclamation-heavy or gamer-excited. Keep new
  UI copy consistent with this.
- **Rarity is felt in texture, not glow.** If you're touching the reveal
  or collection grid, match the existing ASCII-dither system
  (`src/components/spin/dither-field.tsx`,
  `src/components/collection/dither.ts`) rather than adding a new visual
  language for "special."
- **No live model calls on the hot path.** Card copy is generated in the
  nightly batch job (`scripts/generate-cards.ts`) and cached — a spin
  must never block on an LLM call.

## Data pipeline changes

If you're touching `scripts/ingest-places.ts` or
`scripts/build-station-matrix.ts`, re-run them and commit the refreshed
`data/*.json` snapshots and `data/derive.sqlite` alongside your code
change, so `pnpm install && pnpm dev` keeps working with zero setup for
the next person. See `scripts/README.md` for the exact commands.

## Reporting bugs / proposing features

Open a GitHub issue. For anything that changes the rarity algorithm, the
daily-lock semantics, or the filter/SQL contract, sketch the change
against `CONTRACT.md` first — those three are load-bearing for the rest
of the app.
