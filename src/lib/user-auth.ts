import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

/**
 * Trust-on-first-use pairing for DERIVE's anonymous userId (see
 * src/lib/local-user.ts): the client also mints a secret alongside its
 * userId and sends it on every request. The first secret ever presented
 * for a given userId "claims" it (registered here); every later request
 * for that same userId must present the matching secret. This stops a
 * client from spoofing someone else's userId to read/claim their
 * collection, but — being TOFU — doesn't stop a race on a brand-new id
 * that's never been claimed yet. Accepted tradeoff for an anonymous,
 * no-account app; don't build anything more elaborate on top of this.
 */

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 403 };

export async function authenticateUser(userId: string, secret: string | null): Promise<AuthResult> {
  if (!secret) return { ok: false, status: 401 };

  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const candidateHash = hashSecret(secret);

  if (!existing) {
    await db.insert(users).values({ id: userId, secretHash: candidateHash });
    return { ok: true };
  }

  const storedBuf = Buffer.from(existing.secretHash, "hex");
  const candidateBuf = Buffer.from(candidateHash, "hex");
  if (storedBuf.length !== candidateBuf.length || !timingSafeEqual(storedBuf, candidateBuf)) {
    return { ok: false, status: 403 };
  }
  return { ok: true };
}
