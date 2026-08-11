import { NextResponse, type NextRequest } from "next/server";
import { getCollection } from "@/components/collection/get-collection";

export const dynamic = "force-dynamic";

/** Small fetchable counterpart to the server-component `/collection` page —
 * useful for a future client-side refresh without a full page reload. */
export async function GET(request: NextRequest) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "missing_user_id", message: "?userId= is required." }, { status: 400 });
  }

  const collection = await getCollection(userId);
  return NextResponse.json(collection);
}
