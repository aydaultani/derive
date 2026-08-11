/**
 * Overpass API client used by scripts/ingest-places.ts.
 *
 * Real network calls, no mocking. Degrades gracefully: retries the primary
 * endpoint once (I observed a transient Overpass dispatcher 5xx in testing),
 * then falls back to the kumi.systems mirror. If both fail, logs a warning
 * and returns an empty element list so the caller can keep going with
 * whatever it already has instead of hanging the whole ingest run.
 */

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

const PRIMARY_URL = process.env.OVERPASS_API_URL ?? "https://overpass-api.de/api/interpreter";
const FALLBACK_URL = "https://overpass.kumi.systems/api/interpreter";

// Overpass/Nominatim usage policy requires a descriptive User-Agent that
// identifies the app and a contact point.
const USER_AGENT = "derive-dev/0.1 (NYC subway-discovery app; one-time data ingest; contact ad7994@nyu.edu)";

const REQUEST_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postOverpass(url: string, query: string): Promise<OverpassResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Overpass ${url} responded ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as OverpassResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one Overpass QL query, with the retry/fallback policy documented
 * above. Never throws — returns [] on total failure so a single bad
 * borough/neighborhood query doesn't take down the whole ingest run.
 */
export async function runOverpassQuery(query: string, label: string): Promise<OverpassElement[]> {
  // Attempt 1 + 1 retry against the primary endpoint.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await postOverpass(PRIMARY_URL, query);
      return res.elements;
    } catch (err) {
      console.warn(`[overpass] ${label}: primary attempt ${attempt} failed — ${(err as Error).message}`);
      if (attempt === 1) await sleep(8000);
    }
  }

  // Fallback mirror, single attempt.
  try {
    console.warn(`[overpass] ${label}: falling back to mirror ${FALLBACK_URL}`);
    const res = await postOverpass(FALLBACK_URL, query);
    return res.elements;
  } catch (err) {
    console.warn(
      `[overpass] ${label}: fallback also failed — ${(err as Error).message}. Skipping this query, continuing with what we already have.`,
    );
    return [];
  }
}
