import { NextResponse, type NextRequest } from "next/server";
import { getCollection } from "@/components/collection/get-collection";
import { authenticateUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

/** Small fetchable counterpart to the server-component `/collection` page —
 * useful for a future client-side refresh without a full page reload. */
export async function GET(request: NextRequest) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "missing_user_id", message: "?userId= is required." }, { status: 400 });
  }

  const auth = await authenticateUser(userId, request.headers.get("x-derive-user-secret"));
  if (!auth.ok) {
    return NextResponse.json({ error: "forbidden", message: "Couldn't verify this user." }, { status: auth.status });
  }

  const collection = await getCollection(userId);
  return NextResponse.json(collection);
}
