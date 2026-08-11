import { z } from "zod";

/**
 * Shared contract for DERIVE. Every track (data pipeline, rarity engine,
 * API routes, UI) imports types from here rather than redeclaring shapes.
 * If a field needs to change, change it here first.
 */

export const BOROUGHS = [
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "staten_island",
] as const;
export const BoroughSchema = z.enum(BOROUGHS);
export type Borough = z.infer<typeof BoroughSchema>;

export const CATEGORIES = [
  "food",
  "drink",
  "park",
  "water",
  "art",
  "historic",
  "weird",
  "viewpoint",
  "shop",
  "transit-oddity",
] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

export const RARITY_TIERS = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;
export const RarityTierSchema = z.enum(RARITY_TIERS);
export type RarityTier = z.infer<typeof RarityTierSchema>;

/** Tunable in one place — scripts/config/rarity-weights.ts mirrors this shape at runtime. */
export const RARITY_WEIGHTS: Record<RarityTier, number> = {
  common: 0.55,
  uncommon: 0.27,
  rare: 0.13,
  epic: 0.045,
  legendary: 0.005,
};

export const BUDGET_TIERS = ["free", "under_15", "any"] as const;
export const BudgetTierSchema = z.enum(BUDGET_TIERS);
export type BudgetTier = z.infer<typeof BudgetTierSchema>;

export const TIME_WINDOWS = ["any", "sunrise", "late_night"] as const;
export const TimeWindowSchema = z.enum(TIME_WINDOWS);
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const PROOF_TYPES = ["photo", "honor"] as const;
export const ProofTypeSchema = z.enum(PROOF_TYPES);
export type ProofType = z.infer<typeof ProofTypeSchema>;

export const CARD_STATUSES = ["locked", "completed", "expired"] as const;
export const CardStatusSchema = z.enum(CARD_STATUSES);
export type CardStatus = z.infer<typeof CardStatusSchema>;

// ---------------------------------------------------------------------------
// Place (output of the OSM ingest pipeline, one row per real-world location)
// ---------------------------------------------------------------------------
export const PlaceSchema = z.object({
  id: z.string(), // `${osmType}/${osmId}`
  osmId: z.string(),
  osmType: z.enum(["node", "way", "relation"]),
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  borough: BoroughSchema,
  category: CategorySchema,
  tags: z.record(z.string(), z.string()), // raw OSM tags
  tagCount: z.number().int().nonnegative(),
  address: z.string().nullable(),
  openingHoursRaw: z.string().nullable(),
  budgetTier: BudgetTierSchema,
  indoor: z.boolean(),
  nearestStationId: z.string(),
  walkMinutesToStation: z.number().nonnegative(),
  stepFreeOk: z.boolean(),
  touristDistanceM: z.number().nonnegative(),
  qualityScore: z.number().min(0).max(1), // garbage filter output; below threshold => excluded from ingest
});
export type Place = z.infer<typeof PlaceSchema>;

// ---------------------------------------------------------------------------
// Station (GTFS stop / complex)
// ---------------------------------------------------------------------------
export const StationSchema = z.object({
  id: z.string(), // GTFS parent stop_id / complex id
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  borough: BoroughSchema,
  lines: z.array(z.string()),
  ada: z.boolean(), // has elevator/escalator per MTA equipment dataset
});
export type Station = z.infer<typeof StationSchema>;

// ---------------------------------------------------------------------------
// Filters (client-persisted in localStorage, sent with every spin request —
// must translate directly into SQL predicates, never post-hoc array filtering)
// ---------------------------------------------------------------------------
export const FiltersSchema = z.object({
  maxTravelMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal("any")]),
  boroughs: z.array(BoroughSchema), // empty = all
  categories: z.array(CategorySchema), // empty = all
  rarityFloor: RarityTierSchema,
  openNow: z.boolean(),
  budget: BudgetTierSchema,
  indoorOnly: z.boolean(),
  stepFreeOnly: z.boolean(),
  timeOfDay: TimeWindowSchema,
});
export type Filters = z.infer<typeof FiltersSchema>;

export const DEFAULT_FILTERS: Filters = {
  maxTravelMinutes: "any",
  boroughs: [],
  categories: [],
  rarityFloor: "common",
  openNow: false,
  budget: "any",
  indoorOnly: false,
  stepFreeOnly: false,
  timeOfDay: "any",
};

// ---------------------------------------------------------------------------
// Card (a dealt spin result — server-seeded, locked once dealt)
// ---------------------------------------------------------------------------
export const CardSchema = z.object({
  id: z.string(),
  userId: z.string(),
  dealtDate: z.string(), // YYYY-MM-DD, in the user's local timezone at spin time
  timezone: z.string(), // IANA tz name, e.g. "America/New_York"
  placeId: z.string(),
  rarityTier: RarityTierSchema,
  score: z.number(),
  travelMinutes: z.number(),
  viaLine: z.string(), // drives the MTA-line tint
  name: z.string(),
  reason: z.string(),
  dare: z.string(),
  timeWindow: TimeWindowSchema,
  status: CardStatusSchema,
  proofType: ProofTypeSchema.nullable(),
  photoPath: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  originLabel: z.string(),
  originLat: z.number(),
  originLon: z.number(),
});
export type Card = z.infer<typeof CardSchema>;

// ---------------------------------------------------------------------------
// API request/response contracts
// ---------------------------------------------------------------------------
export const SpinRequestSchema = z.object({
  userId: z.string().min(1),
  origin: z.string().min(3), // free-text address or ZIP
  timezone: z.string().min(1),
  filters: FiltersSchema,
});
export type SpinRequest = z.infer<typeof SpinRequestSchema>;

export const SpinResponseSchema = z.union([
  z.object({ ok: z.literal(true), card: CardSchema, poolSize: z.number() }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["already_dealt", "geocode_failed", "pool_too_small", "invalid_filters"]),
    message: z.string(),
    existingCard: CardSchema.nullable().optional(),
  }),
]);
export type SpinResponse = z.infer<typeof SpinResponseSchema>;

export const ProofSubmitSchema = z.object({
  cardId: z.string(),
  userId: z.string(),
  proofType: ProofTypeSchema,
  lat: z.number().optional(),
  lon: z.number().optional(),
  photoDataUrl: z.string().optional(),
});
export type ProofSubmit = z.infer<typeof ProofSubmitSchema>;

export const PROOF_RADIUS_METERS = 150;
