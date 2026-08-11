/**
 * scripts/generate-cards.ts
 *
 * Nightly batch job: for every place in data/osm/places.json, produce card
 * copy (name, reason, dare, timeWindow) and cache it in `card_copy_cache`
 * so a spin never makes a live model call (CONTRACT.md / product brief).
 *
 * If ANTHROPIC_API_KEY is set, generates via the Anthropic API. If it's
 * not set (the default — DERIVE ships with zero required API keys), or a
 * generation call fails for any reason, falls back to a template-based
 * generator. This is not a stub: per the product brief, "if generation
 * fails, fall back to a committed default set so the app never breaks,"
 * and the fallback path is exactly what's committed to data/derive.sqlite
 * for anyone who clones the repo without a key.
 *
 * Re-run: `pnpm generate:cards` (requires data/osm/places.json to exist —
 * run scripts/ingest-places.ts first).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/db/client";
import { cardCopyCache } from "../src/db/schema";
import { PlaceSchema, type Place, type TimeWindow } from "../src/lib/schemas";
import { passesCopySafety } from "./lib/copy-safety";

const PLACES_PATH = path.join(process.cwd(), "data", "osm", "places.json");
const CONCURRENCY = 4;

// Counts LLM copy rejected by passesCopySafety, tracked separately from
// other llmCopyFor failures (network/parse/rate-limit) so the summary log
// can call out when the safety check specifically did its job.
let safetyRejectedCount = 0;

interface Copy {
  name: string;
  reason: string;
  dare: string;
  timeWindow: TimeWindow;
}

// ---------------------------------------------------------------------------
// Deterministic per-place pick — so re-running the fallback generator on an
// unchanged place list is idempotent (same output every time), the same way
// rollCard's seeded PRNG makes a spin reproducible. No randomness that
// changes across runs.
// ---------------------------------------------------------------------------
function hashPick<T>(seed: string, options: readonly T[]): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Math.abs(h) % options.length;
  return options[idx];
}

// ---------------------------------------------------------------------------
// Fallback template bank — terse, signage-register copy per category.
// Multiple variants per slot so 2,200 places don't read as 2,200 repeats
// of one string. `{name}` is substituted with the place's cleaned OSM name.
// ---------------------------------------------------------------------------
const REASON_TEMPLATES: Record<Place["category"], string[]> = {
  food: [
    "The kind of place that doesn't need a sign to stay full.",
    "Nobody here is performing for a review.",
    "Order what the person ahead of you ordered.",
    "Regulars outnumber everyone else by design.",
  ],
  drink: [
    "The good conversations here happen after the second round.",
    "A bar that hasn't redecorated for anyone.",
    "Sit at the bar, not a table — that's where the place actually is.",
    "Loud enough to talk, quiet enough to hear the answer.",
  ],
  park: [
    "Worth the trip on a day with nothing else planned.",
    "Bring nothing and stay longer than you meant to.",
    "The kind of green space nobody photographs for a reason.",
    "Empty on weekdays for no good reason.",
  ],
  water: [
    "The waterline changes the whole feeling of the block.",
    "Most of the city forgets this is on the water at all.",
    "Low tide tells a different story than high tide.",
    "Worth seeing before someone puts a fence around it.",
  ],
  art: [
    "Small enough to actually look at everything.",
    "Nobody's rushing you through this one.",
    "The kind of collection that rewards a second pass.",
    "Free to look, easy to skip — don't skip it.",
  ],
  historic: [
    "Still standing for reasons most people walk past without asking.",
    "The plaque undersells it.",
    "Older than most of what's around it, and it shows.",
    "A stop that explains something about how the block got its shape.",
  ],
  weird: [
    "Hard to explain until you've seen it.",
    "The kind of stop that makes a good text message.",
    "Not on purpose, which is exactly why it's worth it.",
    "This one doesn't fit any category cleanly, including this one.",
  ],
  viewpoint: [
    "The skyline reads differently from here than from anywhere closer in.",
    "Worth the climb, worth the wait for the light.",
    "Most people look at the city; this is a place to look from it.",
    "Better at the edges of the day than at noon.",
  ],
  shop: [
    "Still run the way it opened.",
    "The inventory tells you more than the sign does.",
    "Worth a look even if you're not buying anything.",
    "Small enough that the owner probably remembers you.",
  ],
  "transit-oddity": [
    "A piece of the system most riders never notice.",
    "The kind of infrastructure that outlived its own explanation.",
    "Worth a look the next time you're not in a hurry to catch a train.",
    "Proof the system is older and stranger than the map admits.",
  ],
};

const DARE_TEMPLATES: Record<Place["category"], string[]> = {
  food: [
    "Order what the person ahead of you ordered.",
    "Ask what's actually good before you order anything.",
    "Eat standing up if there's nowhere to sit.",
    "Leave your phone in your pocket until the food arrives.",
  ],
  drink: [
    "Sit at the bar and start a conversation with a stranger.",
    "Order whatever the bartender is drinking.",
    "Stay for one more than you planned.",
    "Ask someone nearby what brought them here tonight.",
  ],
  park: [
    "Stay until you've read ten pages of something.",
    "Find a bench and sit on it for fifteen minutes doing nothing.",
    "Walk the whole perimeter before you leave.",
    "Sit somewhere without checking your phone once.",
  ],
  water: [
    "Watch the water for five full minutes before you do anything else.",
    "Find the exact spot where the water meets the block and stand there.",
    "Photograph the tide before you leave.",
    "Skip a stone if there's anything to skip it off of.",
  ],
  art: [
    "Pick one piece and look at it for two full minutes.",
    "Find the piece you like least and explain to yourself why.",
    "Ask a staff member which piece they'd take home.",
    "Leave without taking a single photo.",
  ],
  historic: [
    "Find the plaque and photograph it.",
    "Read every word of the posted history before you leave.",
    "Find the oldest visible detail on the building.",
    "Ask someone nearby if they know the story of this place.",
  ],
  weird: [
    "Take a photo that explains what this place is without a caption.",
    "Find the detail that makes this place weird and stand in front of it.",
    "Describe this place out loud to yourself in one sentence.",
    "Leave a note for whoever finds this card next.",
  ],
  viewpoint: [
    "Stay until the light changes.",
    "Find the skyline landmark you didn't expect to see from here.",
    "Take one photo, then put the phone away and just look.",
    "Count how many boroughs you can actually see.",
  ],
  shop: [
    "Buy the smallest thing they sell.",
    "Ask the person behind the counter how long they've been here.",
    "Find the oldest item in the store.",
    "Leave with something you didn't come in looking for.",
  ],
  "transit-oddity": [
    "Find the detail that explains what this actually is.",
    "Take the long way back on foot instead of the train.",
    "Photograph it before you're sure anyone will believe you.",
    "Look for the part of it that doesn't get used anymore.",
  ],
};

const SUNRISE_CATEGORIES = new Set<Place["category"]>(["viewpoint", "water", "park"]);
const LATE_NIGHT_CATEGORIES = new Set<Place["category"]>(["drink", "weird"]);

function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function timeWindowFor(place: Place): TimeWindow {
  // Most cards deal any time — sunrise/late-night is a deliberate minority
  // (per brief: "some cards should only deal at sunrise or after 10pm"),
  // deterministically chosen so re-runs are stable.
  const roll = hashPick(`${place.id}:window`, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  if (SUNRISE_CATEGORIES.has(place.category) && roll === 0) return "sunrise";
  if (LATE_NIGHT_CATEGORIES.has(place.category) && roll === 1) return "late_night";
  return "any";
}

function fallbackCopyFor(place: Place): Copy {
  const copy = {
    name: cleanName(place.name),
    reason: hashPick(`${place.id}:reason`, REASON_TEMPLATES[place.category]),
    dare: hashPick(`${place.id}:dare`, DARE_TEMPLATES[place.category]),
    timeWindow: timeWindowFor(place),
  };
  // The template bank is hand-authored and hardcoded — a safety violation
  // here is an author bug in this file, not a runtime condition to fall
  // back from. Fail loud rather than silently shipping bad copy.
  if (!passesCopySafety(copy)) {
    throw new Error(`fallback template failed copy safety check for place ${place.id}: ${JSON.stringify(copy)}`);
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Optional live generation path — only exercised when ANTHROPIC_API_KEY is
// set. Not exercised in this environment (no key present); the fallback
// path above is what's actually committed.
// ---------------------------------------------------------------------------
async function llmCopyFor(place: Place): Promise<Copy | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You write terse, declarative copy for DERIVE, a NYC "loot box" app that deals a real place and a dare. Voice: signage-register, not gamer-excited. Given this OpenStreetMap place, return strict JSON {"name": string, "reason": string (one line, why it's worth the trip), "dare": string (one imperative instruction that makes the trip a story)}.\n\nPlace: ${JSON.stringify({ name: place.name, category: place.category, tags: place.tags })}`,
        },
      ],
    });
    const block = msg.content.find((b: { type: string }) => b.type === "text") as { type: string; text?: string } | undefined;
    if (!block?.text) return null;
    const parsed: unknown = JSON.parse(block.text);
    const obj = parsed as { name?: unknown; reason?: unknown; dare?: unknown };
    if (typeof obj.name !== "string" || typeof obj.reason !== "string" || typeof obj.dare !== "string") return null;
    const copy = { name: obj.name, reason: obj.reason, dare: obj.dare, timeWindow: timeWindowFor(place) };
    // Model output is the one path with no committed, pre-reviewed text —
    // reject anything that reads like a real access code (or an
    // instruction to go get one) rather than caching it. Falls through to
    // the template generator just like any other generation failure.
    if (!passesCopySafety(copy)) {
      safetyRejectedCount++;
      return null;
    }
    return copy;
  } catch {
    return null; // any failure — network, parse, rate limit — falls through to the template generator
  }
}

async function main() {
  const raw = await readFile(PLACES_PATH, "utf8");
  const places = (JSON.parse(raw) as unknown[]).map((p) => PlaceSchema.parse(p));
  console.log(`Generating card copy for ${places.length} places (ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? "set" : "not set — using fallback templates"})...`);

  let llmCount = 0;
  let fallbackCount = 0;
  const generatedAt = new Date().toISOString();

  for (let i = 0; i < places.length; i += CONCURRENCY) {
    const batch = places.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (place) => {
        const llm = await llmCopyFor(place);
        const copy = llm ?? fallbackCopyFor(place);
        if (llm) llmCount++;
        else fallbackCount++;
        return { place, copy, source: llm ? ("llm" as const) : ("fallback" as const) };
      }),
    );
    for (const { place, copy, source } of results) {
      db.insert(cardCopyCache)
        .values({
          placeId: place.id,
          name: copy.name,
          reason: copy.reason,
          dare: copy.dare,
          timeWindow: copy.timeWindow,
          source,
          generatedAt,
        })
        .onConflictDoUpdate({
          target: cardCopyCache.placeId,
          set: { name: copy.name, reason: copy.reason, dare: copy.dare, timeWindow: copy.timeWindow, source, generatedAt },
        })
        .run();
    }
    if ((i / CONCURRENCY) % 50 === 0) {
      console.log(`  ${Math.min(i + CONCURRENCY, places.length)}/${places.length}`);
    }
  }

  console.log(`Done. llm=${llmCount} fallback=${fallbackCount} (${safetyRejectedCount} LLM results rejected by copy-safety check and replaced with a template)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
