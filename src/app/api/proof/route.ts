import { eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cards, places } from "@/db/schema";
import { PROOF_RADIUS_METERS, ProofSubmitSchema } from "@/lib/schemas";
import { authenticateUser } from "@/lib/user-auth";

/**
 * Orchestration-only glue to `cards`: validates the request, checks the
 * card belongs to the requesting user and isn't already completed/expired,
 * then marks it completed via one of two paths (photo, geofenced against
 * PROOF_RADIUS_METERS; or honor, no coordinate check). The `cards` row
 * itself is created by the spin-api track — this route only updates it.
 */

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

type ProofErrorCode =
  | "invalid_request"
  | "not_found"
  | "forbidden"
  | "already_completed"
  | "expired"
  | "missing_photo_data"
  | "out_of_range";

type ProofResponse =
  | { ok: true; status: "completed"; proofType: "photo" | "honor"; completedAt: string }
  | { ok: false; error: ProofErrorCode; message: string; distanceMeters?: number };

function jsonError(error: ProofErrorCode, message: string, status: number, distanceMeters?: number) {
  const body: ProofResponse = distanceMeters === undefined
    ? { ok: false, error, message }
    : { ok: false, error, message, distanceMeters };
  return NextResponse.json(body, { status });
}

/** Great-circle distance in meters. */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * A card is "expired" once local midnight ending `dealtDate` has passed in
 * the card's own timezone, computed lazily here rather than on a cron (per
 * CONTRACT.md's daily-lock spec). Only meaningful while `status` is still
 * "locked" — a completed card is never re-flagged as expired.
 */
function isCardExpired(card: { dealtDate: string; timezone: string; status: string }, now: Date): boolean {
  if (card.status !== "locked") return false;
  const currentLocalDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: card.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return currentLocalDate > card.dealtDate;
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; extension: string } | null {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const [, subtype, base64] = match;
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  try {
    return { buffer: Buffer.from(base64, "base64"), extension };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_request", "Request body must be JSON.", 400);
  }

  const parsed = ProofSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("invalid_request", parsed.error.issues.map((i) => i.message).join("; "), 400);
  }
  const { cardId, userId, proofType, lat, lon, photoDataUrl } = parsed.data;

  const auth = await authenticateUser(userId, request.headers.get("x-derive-user-secret"));
  if (!auth.ok) {
    return jsonError("forbidden", "Couldn't verify this user.", auth.status);
  }

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) {
    return jsonError("not_found", "No card with that id.", 404);
  }
  if (card.userId !== userId) {
    return jsonError("forbidden", "This card doesn't belong to the requesting user.", 403);
  }
  if (card.status === "completed") {
    return jsonError("already_completed", "This card is already marked complete.", 409);
  }

  const now = new Date();
  if (isCardExpired(card, now)) {
    return jsonError("expired", "This card expired at local midnight — no more proof submissions.", 409);
  }

  const completedAt = now.toISOString();

  if (proofType === "honor") {
    await db
      .update(cards)
      .set({ status: "completed", proofType: "honor", completedAt, photoPath: null })
      .where(eq(cards.id, cardId));

    return NextResponse.json(
      { ok: true, status: "completed", proofType: "honor", completedAt } satisfies ProofResponse,
      { status: 200 },
    );
  }

  // proofType === "photo"
  if (lat === undefined || lon === undefined || !photoDataUrl) {
    return jsonError("missing_photo_data", "Photo proof requires lat, lon, and photoDataUrl.", 400);
  }

  const [place] = await db.select().from(places).where(eq(places.id, card.placeId)).limit(1);
  if (!place) {
    return jsonError("not_found", "The place behind this card no longer exists.", 404);
  }

  const distanceMeters = haversineMeters(lat, lon, place.lat, place.lon);
  if (distanceMeters > PROOF_RADIUS_METERS) {
    return jsonError(
      "out_of_range",
      `You're ${Math.round(distanceMeters)}m from the place — need to be within ${PROOF_RADIUS_METERS}m.`,
      422,
      Math.round(distanceMeters),
    );
  }

  const decoded = decodeDataUrl(photoDataUrl);
  if (!decoded) {
    return jsonError("missing_photo_data", "Couldn't decode photoDataUrl — expected a data: image URL.", 400);
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  const photoPath = path.join("data", "uploads", `${cardId}.${decoded.extension}`);
  await writeFile(path.join(process.cwd(), photoPath), decoded.buffer);

  await db
    .update(cards)
    .set({ status: "completed", proofType: "photo", completedAt, photoPath })
    .where(eq(cards.id, cardId));

  return NextResponse.json(
    { ok: true, status: "completed", proofType: "photo", completedAt } satisfies ProofResponse,
    { status: 200 },
  );
}
