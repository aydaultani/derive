import { z } from "zod";

/**
 * Geocodes a free-text NYC address or bare 5-digit ZIP via the public
 * Nominatim (OpenStreetMap) search API. No API key required, but Nominatim's
 * usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * requires a descriptive User-Agent identifying the app/instance and caps
 * unauthenticated traffic at ~1 request/second — callers (spin.ts) should
 * only call this once per spin, never in a loop.
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

function buildParams(query: string): URLSearchParams {
  const params = new URLSearchParams({
    format: "json",
    countrycodes: "us",
    limit: "1",
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

export async function geocodeOrigin(query: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const url = `${NOMINATIM_SEARCH_URL}?${buildParams(trimmed).toString()}`;

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
    return null;
  }

  if (!res.ok) return null;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  const parsed = NominatimResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.length === 0) return null;

  const [first] = parsed.data;
  const lat = Number.parseFloat(first.lat);
  const lon = Number.parseFloat(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon, label: first.display_name };
}
