/**
 * Garbage filter for raw OSM elements.
 *
 * Goal: exclude single-node entries that only have a `name` and nothing
 * else useful (no real category tag beyond the one that got them matched,
 * no opening_hours, no address, no other descriptive tag). A lot of OSM
 * data is exactly this — someone dropped a `shop=yes` pin with a name and
 * walked away — and it makes for a dead, un-dareable card.
 *
 * Two-stage filter:
 *  1. `meaningfulTagCount` — count tags that aren't pure editing/provenance
 *     metadata (source, note, fixme, import housekeeping, etc.) and aren't
 *     the `name`/`name:*` tags themselves (name is a precondition, not a
 *     point in favor — every candidate has one).
 *  2. `qualityScore` — a 0..1 richness score built from that count plus
 *     bonus weight for specific high-signal descriptive tags
 *     (opening_hours, an address, a website/phone, a wikidata/wikipedia
 *     link). This is what gets stored on the Place record and is also one
 *     of the three rarity inputs (tag sparsity) per CONTRACT.md.
 *
 * A place passes ingest when it has a non-empty name AND at least 2
 * meaningful tags AND qualityScore >= QUALITY_THRESHOLD.
 */

// Tag keys/prefixes that are OSM editing/provenance metadata, not
// descriptive information about the place itself.
const META_TAG_PREFIXES = [
  "source",
  "note",
  "fixme",
  "created_by",
  "import",
  "survey",
  "check_date",
  "attribution",
  "wikidata:",
  // Deprecated / non-descriptive bookkeeping tags occasionally present.
  "old_name",
  "fee_note",
];

function isMetaTag(key: string): boolean {
  const k = key.toLowerCase();
  if (k === "name" || k.startsWith("name:")) return false; // handled separately, never counts
  return META_TAG_PREFIXES.some((p) => k === p || k.startsWith(`${p}:`) || k.startsWith(p));
}

export function meaningfulTagKeys(tags: Record<string, string>): string[] {
  return Object.keys(tags).filter((k) => !isMetaTag(k) && k !== "name" && !k.startsWith("name:"));
}

export const QUALITY_THRESHOLD = 0.15;

/**
 * 0..1 richness score. Saturates at 5 meaningful tags (a place with 5+
 * descriptive tags is "rich" for our purposes — we're not trying to reward
 * OSM power-mapping beyond that), plus flat bonuses for specific
 * high-signal fields that make for a better card (you can tell someone
 * "check the hours" or give a real cross-street).
 */
export function qualityScore(tags: Record<string, string>): number {
  const meaningful = meaningfulTagKeys(tags);
  const tagRichness = Math.min(meaningful.length / 5, 1);

  const hasOpeningHours = Boolean(tags.opening_hours);
  const hasAddress = Boolean(tags["addr:housenumber"] || tags["addr:street"] || tags["addr:full"]);
  const hasContact = Boolean(tags.website || tags.phone || tags["contact:phone"] || tags["contact:website"]);
  const hasWiki = Boolean(tags.wikidata || tags.wikipedia);

  const raw =
    0.5 * tagRichness +
    (hasOpeningHours ? 0.15 : 0) +
    (hasAddress ? 0.15 : 0) +
    (hasContact ? 0.1 : 0) +
    (hasWiki ? 0.1 : 0);

  return Math.min(raw, 1);
}

/**
 * Pure transit-infrastructure `railway` values — the point entity for an
 * operating station/platform itself, not a place to send someone. These
 * come through the far-out neighborhoods' unfiltered tag net (see
 * overpass-queries.ts) and would otherwise flood `transit-oddity` with
 * "every stop on the A train," which isn't a distinct destination from
 * the subway system that gets you there. `disused` (an abandoned
 * station) and `subway_entrance` (a specific street-level landmark) are
 * deliberately NOT excluded — those are real, dareable oddities.
 */
const EXCLUDED_RAILWAY_VALUES = new Set([
  "station", "halt", "platform", "stop_position", "signal_box",
  "buffer_stop", "level_crossing", "crossing", "switch", "milestone",
  "junction", "yard", "turntable", "workshop", "wash",
]);

export function isPureTransitInfrastructure(tags: Record<string, string>): boolean {
  if (tags.railway && EXCLUDED_RAILWAY_VALUES.has(tags.railway)) return true;
  if (tags.public_transport === "station" || tags.public_transport === "platform") return true;
  return false;
}

/**
 * Private institutional/care venues — schools, daycares, clinics, nursing
 * homes, etc. These slip in through the far-out neighborhoods' unfiltered
 * tag net (see overpass-queries.ts's buildAroundQuery, which pulls every
 * amenity value rather than a curated allowlist) and are never appropriate
 * to send a stranger to as a "go visit + do a dare" destination — they
 * serve children, patients, or vulnerable residents, not casual visitors.
 * `tags.healthcare` catches pharmacies/clinics/dentists/optometrists that
 * use the newer healthcare=* tagging instead of (or alongside) amenity=*.
 */
const EXCLUDED_AMENITY_VALUES = new Set([
  "childcare", "kindergarten", "school", "university", "college",
  "hospital", "clinic", "doctors", "dentist", "veterinary", "pharmacy",
  "social_facility", "prison", "crematorium", "mortuary", "funeral_hall",
]);

export function isInappropriateVenue(tags: Record<string, string>): boolean {
  if (tags.amenity && EXCLUDED_AMENITY_VALUES.has(tags.amenity)) return true;
  if (tags.social_facility) return true;
  if (tags.healthcare) return true;
  return false;
}

export interface QualityCheckInput {
  name: string | undefined;
  tags: Record<string, string>;
}

export function passesQualityFilter({ name, tags }: QualityCheckInput): boolean {
  if (!name || !name.trim()) return false;
  if (isPureTransitInfrastructure(tags)) return false;
  if (isInappropriateVenue(tags)) return false;
  if (meaningfulTagKeys(tags).length < 2) return false;
  return qualityScore(tags) >= QUALITY_THRESHOLD;
}
