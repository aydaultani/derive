import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { DEFAULT_FILTERS } from "@/lib/schemas";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;

vi.mock("@/db/client", () => ({
  get db() {
    return testDb;
  },
}));

// Minimal schema — just the tables buildPlaceQuery touches (places,
// stations, card_copy_cache). Mirrors the in-memory setup in spin.test.ts.
function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE places (
      id TEXT PRIMARY KEY,
      osm_id TEXT NOT NULL,
      osm_type TEXT NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      borough TEXT NOT NULL,
      category TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      tag_count INTEGER NOT NULL,
      address TEXT,
      opening_hours_raw TEXT,
      budget_tier TEXT NOT NULL,
      indoor INTEGER NOT NULL,
      nearest_station_id TEXT NOT NULL,
      walk_minutes_to_station REAL NOT NULL,
      step_free_ok INTEGER NOT NULL,
      tourist_distance_m REAL NOT NULL,
      quality_score REAL NOT NULL,
      source_updated_at TEXT NOT NULL
    );

    CREATE TABLE stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      borough TEXT NOT NULL,
      lines_json TEXT NOT NULL,
      ada INTEGER NOT NULL
    );

    CREATE TABLE card_copy_cache (
      place_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      reason TEXT NOT NULL,
      dare TEXT NOT NULL,
      time_window TEXT NOT NULL DEFAULT 'any',
      source TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);
  return drizzle(sqlite, { schema });
}

function seedPlace(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  const row = {
    id,
    osm_id: id,
    osm_type: "node",
    name: `Place ${id}`,
    lat: 40.7,
    lon: -73.9,
    borough: "queens",
    category: "park",
    tags_json: "{}",
    tag_count: 2,
    address: null,
    opening_hours_raw: null,
    budget_tier: "free",
    indoor: 0,
    nearest_station_id: "A24",
    walk_minutes_to_station: 3,
    step_free_ok: 0,
    tourist_distance_m: 8000,
    quality_score: 0.7,
    source_updated_at: new Date().toISOString(),
    ...overrides,
  };
  testDb.$client
    .prepare(
      `INSERT INTO places (id, osm_id, osm_type, name, lat, lon, borough, category, tags_json, tag_count,
        address, opening_hours_raw, budget_tier, indoor, nearest_station_id, walk_minutes_to_station,
        step_free_ok, tourist_distance_m, quality_score, source_updated_at)
       VALUES (@id, @osm_id, @osm_type, @name, @lat, @lon, @borough, @category, @tags_json, @tag_count,
        @address, @opening_hours_raw, @budget_tier, @indoor, @nearest_station_id, @walk_minutes_to_station,
        @step_free_ok, @tourist_distance_m, @quality_score, @source_updated_at)`,
    )
    .run(row);
}

function seedCopy(placeId: string, timeWindow: string) {
  testDb.$client
    .prepare(
      `INSERT INTO card_copy_cache (place_id, name, reason, dare, time_window, source, generated_at)
       VALUES (?, 'x', 'x', 'x', ?, 'fallback', ?)`,
    )
    .run(placeId, timeWindow, new Date().toISOString());
}

beforeEach(() => {
  testDb = createTestDb();
  vi.resetModules();
});

describe("buildPlaceQuery — timeOfDay filter", () => {
  it("includes a place with no card_copy_cache row at all when timeOfDay is set (bug: LEFT JOIN NULL was silently excluded by a bare inArray)", async () => {
    const { buildPlaceQuery } = await import("@/lib/query-builder");

    seedPlace("sunrise-match");
    seedCopy("sunrise-match", "sunrise");

    seedPlace("no-copy-row"); // no card_copy_cache row — NULL after LEFT JOIN

    seedPlace("late-night-only");
    seedCopy("late-night-only", "late_night");

    const rows = await buildPlaceQuery({ ...DEFAULT_FILTERS, timeOfDay: "sunrise" });
    const ids = rows.map((r) => r.id).sort();

    // spin.ts's fallbackCopy() treats a missing copy row as timeWindow
    // "any", which matches every timeOfDay filter — so "no-copy-row" must
    // be included here, not silently dropped.
    expect(ids).toEqual(["no-copy-row", "sunrise-match"]);
    expect(ids).not.toContain("late-night-only");
  });

  it("timeOfDay 'any' (the default) applies no time-window predicate at all", async () => {
    const { buildPlaceQuery } = await import("@/lib/query-builder");

    seedPlace("a");
    seedCopy("a", "sunrise");
    seedPlace("b"); // no copy row

    const rows = await buildPlaceQuery(DEFAULT_FILTERS);
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });
});
