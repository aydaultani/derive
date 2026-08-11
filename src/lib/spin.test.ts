import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { isExpired, localDateISO } from "@/lib/local-date";
import type { Card, Filters, Place } from "@/lib/schemas";
import { DEFAULT_FILTERS } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Mocks for the three pinned-but-not-yet-merged modules (station-matrix.ts,
// query-builder.ts, rarity.ts each belong to a different parallel track and
// don't exist in this worktree yet) plus geocode.ts (real, but we don't want
// spin.test.ts making live network calls).
//
// vi.mock against a specifier that doesn't resolve to a file on disk works
// fine — AS LONG AS exactly one module in the whole test's dependency graph
// imports that specifier. Verified empirically: if two different files both
// have a static import statement for the same not-on-disk relative module
// (even resolving to the identical absolute path — e.g. spin.ts and this
// test file both importing the station-matrix module), Vite's resolver
// fails the *second* occurrence even though the mock is registered —
// apparently only the first resolution attempt gets intercepted. Working
// around it by minting the vi.fn()s via vi.hoisted() and handing the SAME
// references to both the mock factory and the test bodies below, so this
// file never has its own top-level import of the station-matrix,
// query-builder, or rarity modules — only spin.ts does.
//
// Also: never write any of those three modules' relative import paths as a
// quoted string anywhere in this file (including in comments) — Vite's
// import scanner appears to treat that as another occurrence of the same
// specifier and fails resolution, even inside a `//` comment.
// ---------------------------------------------------------------------------
const {
  mockGeocodeOrigin,
  mockLoadStationMatrix,
  mockNearestStation,
  mockTravelBetween,
  mockBuildPlaceQuery,
  mockRollCard,
} = vi.hoisted(() => ({
  mockGeocodeOrigin: vi.fn(),
  mockLoadStationMatrix: vi.fn(),
  mockNearestStation: vi.fn(),
  mockTravelBetween: vi.fn(),
  mockBuildPlaceQuery: vi.fn(),
  mockRollCard: vi.fn(),
}));

vi.mock("@/lib/geocode", () => ({ geocodeOrigin: mockGeocodeOrigin }));
// Mocked by relative specifier (matching how spin.ts imports them) rather
// than the "@/" alias — see the comment on spin.ts's imports for why: Vite's
// alias resolver needs the target file to exist on disk before vi.mock can
// intercept it, but these three don't exist in this worktree yet.
vi.mock("./station-matrix", () => ({
  loadStationMatrix: mockLoadStationMatrix,
  nearestStation: mockNearestStation,
  travelBetween: mockTravelBetween,
}));
vi.mock("./query-builder", () => ({
  buildPlaceQuery: mockBuildPlaceQuery,
  // Real filterOpenNow is a pure JS pass/fail filter over already-fetched
  // rows (see query-builder.ts) — spin.ts's orchestration isn't what's
  // under test here, so a no-op stand-in is enough; DEFAULT_FILTERS used
  // throughout this file has openNow: false anyway, so it would no-op regardless.
  filterOpenNow: (rows: unknown[]) => rows,
}));
vi.mock("./rarity", () => ({ rollCard: mockRollCard }));

// @/db/client is a module-level singleton pointed at the committed sqlite
// file; spin.ts must never touch that in tests. We swap in a fresh
// in-memory better-sqlite3 db per test via a getter so the mock always
// reflects whatever `testDb` currently is, even though the mock factory
// itself runs once, before any test's beforeEach has assigned it.
//
// Typed as ReturnType<typeof drizzle<...>> rather than BetterSQLite3Database
// directly — drizzle()'s actual return type is an intersection with
// `{ $client: Database }` that only shows up on the function's return type,
// not on the BetterSQLite3Database class itself (see @/db/client.ts, which
// gets this for free by never annotating `db` explicitly).
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;
vi.mock("@/db/client", () => ({
  get db() {
    return testDb;
  },
}));

import { getTodaysCard, spin, withComputedStatus } from "@/lib/spin";

// ---------------------------------------------------------------------------
// local-date.ts — timezone-boundary-safe helpers
// ---------------------------------------------------------------------------
describe("localDateISO / isExpired", () => {
  it("computes the correct calendar date across a spring-forward DST transition (America/New_York, 2026-03-08)", () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT is the US spring-forward jump, but
    // that happens well after local midnight; the date boundary itself
    // (11:59pm Mar 7 -> 12:01am Mar 8, both still EST, offset unchanged)
    // must still land on the right side regardless of the later jump.
    expect(localDateISO("America/New_York", new Date("2026-03-08T04:59:00Z"))).toBe("2026-03-07");
    expect(localDateISO("America/New_York", new Date("2026-03-08T05:01:00Z"))).toBe("2026-03-08");
  });

  it("computes the correct calendar date across a fall-back DST transition (America/New_York, 2026-11-01)", () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST fall-back also happens after local
    // midnight; same shape of assertion. Still EDT (UTC-4) right up to the
    // transition, so local midnight lands at 04:00Z, not 05:00Z (that offset
    // only applies once EST is in effect, later that same day).
    expect(localDateISO("America/New_York", new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31");
    expect(localDateISO("America/New_York", new Date("2026-11-01T04:01:00Z"))).toBe("2026-11-01");
  });

  it("gives different users on opposite sides of the international date line different calendar dates for the same instant", () => {
    const instant = new Date("2026-08-12T23:00:00Z");
    // Pacific/Kiritimati is UTC+14 (no DST): 23:00Z + 14h = Aug 13, 13:00.
    expect(localDateISO("Pacific/Kiritimati", instant)).toBe("2026-08-13");
    // Etc/GMT+11 is UTC-11 (Etc/GMT sign convention is inverted): 23:00Z - 11h = Aug 12, 12:00.
    expect(localDateISO("Etc/GMT+11", instant)).toBe("2026-08-12");
  });

  it("computes local date for a NYC ZIP correctly even when the requester's own tz differs (Mumbai typing a NYC ZIP still uses the NYC address's card, but the day boundary is the client's own tz)", () => {
    // The point: localDateISO takes whatever IANA tz the client sends
    // (Asia/Kolkata here), independent of where the geocoded place is.
    const instant = new Date("2026-08-12T19:00:00Z"); // 00:30 IST Aug 13
    expect(localDateISO("Asia/Kolkata", instant)).toBe("2026-08-13");
    expect(localDateISO("America/New_York", instant)).toBe("2026-08-12");
  });

  it("isExpired is false just before local midnight and true just after, in the card's own timezone", () => {
    const dealtDate = "2026-06-13";
    const justBefore = new Date("2026-06-14T03:59:00Z"); // 2026-06-13 23:59 EDT
    const justAfter = new Date("2026-06-14T04:01:00Z"); // 2026-06-14 00:01 EDT
    expect(isExpired(dealtDate, "America/New_York", justBefore)).toBe(false);
    expect(isExpired(dealtDate, "America/New_York", justAfter)).toBe(true);
  });

  it("isExpired is computed per the card's own stored timezone, not a fixed server timezone", () => {
    const instant = new Date("2026-08-13T02:00:00Z"); // 22:00 EDT Aug 12 / 16:00 Kiritimati Aug 13
    expect(isExpired("2026-08-12", "America/New_York", instant)).toBe(false);
    expect(isExpired("2026-08-12", "Pacific/Kiritimati", instant)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spin.ts — orchestration
// ---------------------------------------------------------------------------

function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
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

    CREATE TABLE station_travel_times (
      from_station_id TEXT NOT NULL,
      to_station_id TEXT NOT NULL,
      minutes REAL NOT NULL,
      transfers INTEGER NOT NULL,
      via_line TEXT NOT NULL,
      PRIMARY KEY (from_station_id, to_station_id)
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

    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      dealt_date TEXT NOT NULL,
      timezone TEXT NOT NULL,
      place_id TEXT NOT NULL REFERENCES places(id),
      rarity_tier TEXT NOT NULL,
      score REAL NOT NULL,
      travel_minutes REAL NOT NULL,
      via_line TEXT NOT NULL,
      transfers INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      reason TEXT NOT NULL,
      dare TEXT NOT NULL,
      time_window TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'locked',
      proof_type TEXT,
      photo_path TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (current_timestamp),
      origin_label TEXT NOT NULL,
      origin_lat REAL NOT NULL,
      origin_lon REAL NOT NULL,
      place_lat REAL NOT NULL,
      place_lon REAL NOT NULL,
      CONSTRAINT cards_user_day_unique UNIQUE (user_id, dealt_date)
    );
  `);
  return drizzle(sqlite, { schema });
}

function seedPlace(overrides: Partial<Record<string, unknown>> = {}) {
  const row = {
    id: "node/1",
    osm_id: "1",
    osm_type: "node",
    name: "Broad Channel Nature Trail",
    lat: 40.608,
    lon: -73.8206,
    borough: "queens",
    category: "park",
    tags_json: JSON.stringify({ leisure: "nature_reserve" }),
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
  return row;
}

function baseRequest(overrides: Partial<{ userId: string; origin: string; timezone: string; filters: Filters }> = {}) {
  return {
    userId: "user-1",
    origin: "11414",
    timezone: "America/New_York",
    filters: DEFAULT_FILTERS,
    ...overrides,
  };
}

/** Wires up the standard "happy path" for the mocked collaborators; individual tests override as needed. */
function wireHappyPath() {
  mockGeocodeOrigin.mockResolvedValue({ lat: 40.608, lon: -73.8206, label: "Broad Channel, Queens, NY" });
  mockLoadStationMatrix.mockReturnValue(undefined);
  mockNearestStation.mockReturnValue({
    station: { id: "A24", name: "Broad Channel", lat: 40.608, lon: -73.8206, borough: "queens", lines: ["A"], ada: false },
    walkMinutes: 2,
  });
  mockTravelBetween.mockReturnValue({ minutes: 10, transfers: 0, viaLine: "A" });
  // Real buildPlaceQuery resolves to camelCase PlaceQueryRow objects (see
  // query-builder.ts) — mirror that shape here rather than the placeholder
  // {sql,params} contract this file used to assume before query-builder.ts
  // actually landed.
  mockBuildPlaceQuery.mockResolvedValue([
    {
      id: "node/1",
      osmId: "1",
      osmType: "node",
      name: "Broad Channel Nature Trail",
      lat: 40.608,
      lon: -73.8206,
      borough: "queens",
      category: "park",
      tagsJson: JSON.stringify({ leisure: "nature_reserve" }),
      tagCount: 2,
      address: null,
      openingHoursRaw: null,
      budgetTier: "free",
      indoor: false,
      nearestStationId: "A24",
      walkMinutesToStation: 3,
      stepFreeOk: false,
      touristDistanceM: 8000,
      qualityScore: 0.7,
      sourceUpdatedAt: new Date().toISOString(),
    },
  ]);
  mockRollCard.mockImplementation((pool) => {
    const place = pool[0] as Place;
    return { place, tier: "common", score: 0.42 };
  });
}

beforeEach(() => {
  testDb = createTestDb();
  vi.clearAllMocks();
  wireHappyPath();
});

describe("spin()", () => {
  it("deals a new card and returns an accurate poolSize", async () => {
    seedPlace();
    const result = await spin(baseRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.poolSize).toBe(1);
    expect(result.card.placeId).toBe("node/1");
    expect(result.card.status).toBe("locked");
    expect(result.card.dealtDate).toBe(localDateISO("America/New_York"));
  });

  it("calling spin twice for the same user/day returns the identical card — no reroll", async () => {
    seedPlace();
    const first = await spin(baseRequest());
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected ok:true");

    // If a reroll happened, geocode/roll would be invoked again; make that
    // observable by changing what they'd return if called a second time.
    mockGeocodeOrigin.mockResolvedValue({ lat: 0, lon: 0, label: "should not be used" });
    mockRollCard.mockImplementation(() => {
      throw new Error("rollCard must not be called on an already-dealt day");
    });

    const second = await spin(baseRequest());
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected ok:false");
    expect(second.error).toBe("already_dealt");
    expect(second.existingCard).toEqual(first.card);

    const rows = testDb.$client.prepare("SELECT COUNT(*) as n FROM cards WHERE user_id = ?").get("user-1") as { n: number };
    expect(rows.n).toBe(1);
  });

  it("returns pool_too_small when the filtered pool is empty", async () => {
    mockBuildPlaceQuery.mockResolvedValue([]); // simulates filters that leave nothing standing
    const result = await spin(baseRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).toBe("pool_too_small");
  });

  it("returns pool_too_small when every candidate is unreachable by subway from the origin", async () => {
    seedPlace();
    mockTravelBetween.mockReturnValue(null);
    const result = await spin(baseRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).toBe("pool_too_small");
  });

  it("returns geocode_failed when geocodeOrigin can't resolve the origin", async () => {
    seedPlace();
    mockGeocodeOrigin.mockResolvedValue(null);
    const result = await spin(baseRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).toBe("geocode_failed");
  });

  it("filters out places beyond maxTravelMinutes (origin-dependent, applied post-query)", async () => {
    seedPlace();
    mockTravelBetween.mockReturnValue({ minutes: 50, transfers: 1, viaLine: "A" });
    const result = await spin(baseRequest({ filters: { ...DEFAULT_FILTERS, maxTravelMinutes: 15 } }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error).toBe("pool_too_small");
  });
});

describe("getTodaysCard()", () => {
  it("returns null when the user hasn't spun today", () => {
    expect(getTodaysCard("nobody", "America/New_York")).toBeNull();
  });

  it("returns today's card without invoking geocode/roll at all", async () => {
    seedPlace();
    const spun = await spin(baseRequest());
    expect(spun.ok).toBe(true);

    mockGeocodeOrigin.mockClear();
    mockRollCard.mockClear();

    const card = getTodaysCard("user-1", "America/New_York");
    expect(card).not.toBeNull();
    expect(card?.placeId).toBe("node/1");
    expect(mockGeocodeOrigin).not.toHaveBeenCalled();
    expect(mockRollCard).not.toHaveBeenCalled();
  });
});

describe("withComputedStatus()", () => {
  function makeLockedCard(overrides: Partial<Card> = {}): Card {
    return {
      id: "c1",
      userId: "user-1",
      dealtDate: "2026-08-12",
      timezone: "America/New_York",
      placeId: "node/1",
      rarityTier: "common",
      score: 0.5,
      travelMinutes: 20,
      viaLine: "A",
      transfers: 0,
      name: "Broad Channel",
      reason: "reason",
      dare: "dare",
      timeWindow: "any",
      status: "locked",
      proofType: null,
      photoPath: null,
      completedAt: null,
      createdAt: "2026-08-12T12:00:00.000Z",
      originLabel: "somewhere",
      originLat: 40.7,
      originLon: -73.9,
      placeLat: 40.608,
      placeLon: -73.8206,
      ...overrides,
    };
  }

  it("a locked card becomes expired only after local midnight in its stored timezone", () => {
    const card = makeLockedCard();
    const stillAug12 = new Date("2026-08-13T02:00:00Z"); // 22:00 EDT Aug 12
    const nowAug13 = new Date("2026-08-13T05:00:00Z"); // 01:00 EDT Aug 13

    expect(withComputedStatus(card, stillAug12).status).toBe("locked");
    expect(withComputedStatus(card, nowAug13).status).toBe("expired");
  });

  it("never overrides a completed card's status, even past local midnight", () => {
    const card = makeLockedCard({ status: "completed" });
    const wellPastMidnight = new Date("2026-08-14T12:00:00Z");
    expect(withComputedStatus(card, wellPastMidnight).status).toBe("completed");
  });
});
