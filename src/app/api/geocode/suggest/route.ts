import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { suggestOrigins } from "@/lib/geocode";

export const dynamic = "force-dynamic";

const QuerySchema = z.string().trim().min(3);

/**
 * Autocomplete endpoint backing OriginForm's suggestion dropdown. Mirrors
 * /api/places: unauthenticated, no rate limiting beyond what Nominatim
 * itself imposes (see geocode.ts). A missing/too-short `q` isn't an error —
 * it just means "not enough to search yet", so it 200s with an empty list.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("q") ?? "";

  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ suggestions: [] });
  }

  const suggestions = await suggestOrigins(parsed.data);
  return NextResponse.json({ suggestions });
}
