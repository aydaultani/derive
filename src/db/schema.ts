import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  real,
  integer,
  primaryKey,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema — mirrors src/lib/schemas.ts. Keep field names in sync;
 * the Zod schemas are the runtime-validated contract, this is the storage
 * shape. `data/derive.sqlite` (committed) is generated from this via
 * scripts/ingest-places.ts + scripts/build-station-matrix.ts + drizzle-kit.
 */

export const places = sqliteTable("places", {
  id: text("id").primaryKey(), // `${osmType}/${osmId}`
  osmId: text("osm_id").notNull(),
  osmType: text("osm_type").notNull(), // node | way | relation
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  borough: text("borough").notNull(),
  category: text("category").notNull(),
  tagsJson: text("tags_json").notNull(), // JSON.stringify(raw OSM tags)
  tagCount: integer("tag_count").notNull(),
  address: text("address"),
  openingHoursRaw: text("opening_hours_raw"),
  budgetTier: text("budget_tier").notNull(), // free | under_15 | any
  indoor: integer("indoor", { mode: "boolean" }).notNull(),
  nearestStationId: text("nearest_station_id").notNull(),
  walkMinutesToStation: real("walk_minutes_to_station").notNull(),
  stepFreeOk: integer("step_free_ok", { mode: "boolean" }).notNull(),
  touristDistanceM: real("tourist_distance_m").notNull(),
  qualityScore: real("quality_score").notNull(),
  sourceUpdatedAt: text("source_updated_at").notNull(),
});

export const stations = sqliteTable("stations", {
  id: text("id").primaryKey(), // GTFS parent stop_id / complex id
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  borough: text("borough").notNull(),
  linesJson: text("lines_json").notNull(), // JSON.stringify(string[])
  ada: integer("ada", { mode: "boolean" }).notNull(),
});

/** Precomputed station-to-station travel matrix. One-time build step, not a live routing call. */
export const stationTravelTimes = sqliteTable(
  "station_travel_times",
  {
    fromStationId: text("from_station_id").notNull(),
    toStationId: text("to_station_id").notNull(),
    minutes: real("minutes").notNull(),
    transfers: integer("transfers").notNull(),
    viaLine: text("via_line").notNull(), // dominant line for color tinting
  },
  (t) => [primaryKey({ columns: [t.fromStationId, t.toStationId] })],
);

/** Nightly-batch-generated card copy, cached so spin never makes a live model call. */
export const cardCopyCache = sqliteTable("card_copy_cache", {
  placeId: text("place_id").primaryKey(),
  name: text("name").notNull(),
  reason: text("reason").notNull(),
  dare: text("dare").notNull(),
  timeWindow: text("time_window").notNull().default("any"),
  source: text("source").notNull(), // "llm" | "fallback"
  generatedAt: text("generated_at").notNull(),
});

/**
 * Anonymous identity pairing: `id` is the client-minted userId (opaque
 * UUID from localStorage, see src/lib/local-user.ts), `secretHash` is a
 * SHA-256 hash of a second client-minted secret used to prove control of
 * that id on later requests (trust-on-first-use — see src/lib/user-auth.ts).
 * No FK from cards.userId; adding one risks breaking any preexisting rows.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  secretHash: text("secret_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/** A dealt spin: server-seeded, locked the moment it's dealt. */
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    dealtDate: text("dealt_date").notNull(), // YYYY-MM-DD local
    timezone: text("timezone").notNull(),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id),
    rarityTier: text("rarity_tier").notNull(),
    score: real("score").notNull(),
    travelMinutes: real("travel_minutes").notNull(),
    viaLine: text("via_line").notNull(),
    transfers: integer("transfers").notNull().default(0),
    name: text("name").notNull(),
    reason: text("reason").notNull(),
    dare: text("dare").notNull(),
    timeWindow: text("time_window").notNull(),
    status: text("status").notNull().default("locked"), // locked | completed | expired
    proofType: text("proof_type"), // photo | honor | null
    photoPath: text("photo_path"),
    completedAt: text("completed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    originLabel: text("origin_label").notNull(),
    originLat: real("origin_lat").notNull(),
    originLon: real("origin_lon").notNull(),
    placeLat: real("place_lat").notNull(),
    placeLon: real("place_lon").notNull(),
  },
  (t) => [
    // one card per user per local day — this IS the daily lock
    unique("cards_user_day_unique").on(t.userId, t.dealtDate),
  ],
);
