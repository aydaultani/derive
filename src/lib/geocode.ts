import { z } from "zod";

/**
 * Geocodes a free-text NYC address or bare 5-digit ZIP via the public
 * Nominatim (OpenStreetMap) search API. No API key required, but Nominatim's
 * usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * requires a descriptive User-Agent identifying the app/instance and caps
 * unauthenticated traffic at ~1 request/second — callers (spin.ts) should
 * only call this once per spin, never in a loop.
 *
 * `geocodeOrigin` resolves a single best match (limit=1); `suggestOrigins`
 * requests a small batch of candidates (limit=5) for an autocomplete
 * dropdown. Both share the same request-building, fetch, and response
 * parsing logic via `searchNominatim`.
 */

export interface GeocodeResult {
  lat: number;
  lon: number;
  label: string;
}

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

/**
 * left,top,right,bottom (lon,lat,lon,lat) — a loose box around the five
 * boroughs. Used with bounded=1 to bias/restrict results toward NYC so a
 * bare ZIP or a common street name doesn't resolve somewhere else in the
 * country. Loosen (or drop `bounded`) if this starts producing false
 * negatives on legitimate NYC addresses/ZIPs near the edges.
 */
const NYC_VIEWBOX = "-74.26,40.92,-73.68,40.49";

const DEFAULT_USER_AGENT = "derive-dev (see .env.example NOMINATIM_USER_AGENT)";

const ZIP_RE = /^\d{5}$/;

/** Shape we actually rely on from a Nominatim `/search` response item. */
const NominatimItemSchema = z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
});
const NominatimResponseSchema = z.array(NominatimItemSchema);

function userAgent(): string {
  return process.env.NOMINATIM_USER_AGENT ?? DEFAULT_USER_AGENT;
}

function buildParams(query: string, limit: number): URLSearchParams {
  const params = new URLSearchParams({
    format: "json",
    countrycodes: "us",
    limit: String(limit),
    addressdetails: "0",
    viewbox: NYC_VIEWBOX,
    bounded: "1",
  });

  // Bare 5-digit ZIPs geocode more reliably via the structured `postalcode`
  // param than as a freeform query string.
  if (ZIP_RE.test(query)) {
    params.set("postalcode", query);
    params.set("country", "USA");
  } else {
    params.set("q", query);
  }

  return params;
}

/**
 * Shared request/parse path for both exported functions. Returns the parsed
 * (and numerically-validated) result array, or `[]` on any failure — network
 * error, timeout, non-2xx response, unparseable JSON/schema mismatch.
 */
async function searchNominatim(query: string, limit: number): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${NOMINATIM_SEARCH_URL}?${buildParams(trimmed, limit).toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": userAgent(),
        Accept: "application/json",
      },
      // Nominatim can be slow under load; fail fast rather than hang a spin.
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Network failure, timeout, DNS error, etc.
    return [];
  }

  if (!res.ok) return [];

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return [];
  }

  const parsed = NominatimResponseSchema.safeParse(json);
  if (!parsed.success) return [];

  const results: GeocodeResult[] = [];
  for (const item of parsed.data) {
    const lat = Number.parseFloat(item.lat);
    const lon = Number.parseFloat(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    results.push({ lat, lon, label: item.display_name });
  }
  return results;
}

export async function geocodeOrigin(query: string): Promise<GeocodeResult | null> {
  const [first] = await searchNominatim(query, 1);
  return first ?? null;
}

/**
 * Returns up to a handful of candidate matches for `query`, for an
 * autocomplete/typeahead dropdown. Never throws — any failure (network,
 * timeout, malformed response) resolves to an empty array, same failure
 * style as `geocodeOrigin`'s null-on-failure but shaped for a list.
 */
export async function suggestOrigins(query: string): Promise<GeocodeResult[]> {
  return searchNominatim(query, 5);
}
