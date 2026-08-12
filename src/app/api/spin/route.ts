import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SpinRequestSchema, CardSchema } from "@/lib/schemas";
import { getTodaysCard, spin } from "@/lib/spin";
import { authenticateUser } from "@/lib/user-auth";

/**
 * POST /api/spin — attempt today's spin for (userId, timezone, origin,
 * filters). Body is validated against the pinned SpinRequestSchema; the
 * response body always matches SpinResponseSchema (both the ok:true "new
 * card" branch and the ok:false branches, including already_dealt with the
 * locked card attached — see the design-choice comment on `spin()` in
 * src/lib/spin.ts for why re-serving today's card surfaces through
 * already_dealt rather than a second ok:true shape).
 *
 * All well-formed outcomes — including already_dealt, geocode_failed, and
 * pool_too_small — are 200s: they're valid answers the client is expected
 * to branch on, not server errors. Only a malformed request body (400) or
 * a genuine unhandled failure (500) get non-200 statuses, and the 500 body
 * deliberately does NOT try to squeeze itself into SpinResponseSchema's
 * error enum (none of "already_dealt" / "geocode_failed" / "pool_too_small"
 * / "invalid_filters" honestly describes "something broke on the server"),
 * so callers should treat any non-200 as an out-of-band failure regardless
 * of body shape.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_filters", message: "Malformed JSON body." },
      { status: 400 },
    );
  }

  const parsed = SpinRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_filters",
        message: parsed.error.issues.map((issue) => issue.message).join("; ") || "Invalid spin request.",
      },
      { status: 400 },
    );
  }

  const auth = await authenticateUser(parsed.data.userId, req.headers.get("x-derive-user-secret"));
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, message: "Couldn't verify this user." },
      { status: auth.status },
    );
  }

  try {
    const result = await spin(parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[POST /api/spin] spin() threw:", err);
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }
}

const GetQuerySchema = z.object({
  userId: z.string().min(1, "userId is required"),
  timezone: z.string().min(1, "timezone is required"),
});

/**
 * GET /api/spin?userId=...&timezone=... — read-only lookup of today's
 * already-dealt card, if any. Never spins, never geocodes, never touches
 * the station matrix or rarity roll — this is purely `SELECT ... WHERE
 * (userId, dealtDate)` so the frontend can decide on page load whether to
 * render a spin button or today's locked card, without risking a reroll.
 *
 * Response shape (not part of SpinResponseSchema, which is scoped to the
 * spin *attempt*): `{ ok: true, card: Card | null }`. `card: null` is the
 * "no card yet today" case — not an error.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = GetQuerySchema.safeParse({
    userId: url.searchParams.get("userId") ?? undefined,
    timezone: url.searchParams.get("timezone") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues.map((issue) => issue.message).join("; ") },
      { status: 400 },
    );
  }

  const auth = await authenticateUser(parsed.data.userId, req.headers.get("x-derive-user-secret"));
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, message: "Couldn't verify this user." },
      { status: auth.status },
    );
  }

  try {
    const card = getTodaysCard(parsed.data.userId, parsed.data.timezone);
    return NextResponse.json({ ok: true, card: card ? CardSchema.parse(card) : null });
  } catch (err) {
    console.error("[GET /api/spin] getTodaysCard() threw:", err);
    return NextResponse.json({ ok: false, message: "Something went wrong." }, { status: 500 });
  }
}
