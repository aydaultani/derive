import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { cards, places } from "@/db/schema";
import type { RarityTier } from "@/lib/schemas";

/**
 * Server-only data access for the collection grid — direct DB reads, no
 * HTTP round trip needed since `/collection` is a server component. Also
 * reused by `src/app/api/collection/route.ts` for clients that do want a
 * fetchable endpoint (e.g. a future client-side refresh).
 */

export interface CollectionCell {
  placeId: string;
  placeName: string;
  completed: boolean;
  cardId: string | null;
  reason: string | null;
  dare: string | null;
  rarityTier: RarityTier | null;
  viaLine: string | null;
  proofType: "photo" | "honor" | null;
  completedAt: string | null;
}

export interface CollectionData {
  totalPlaces: number;
  completedCount: number;
  cells: CollectionCell[];
}

export async function getCollection(userId: string): Promise<CollectionData> {
  const allPlaces = await db
    .select({ id: places.id, name: places.name })
    .from(places);

  const completedCards = await db
    .select()
    .from(cards)
    .where(eq(cards.userId, userId));

  // A place can theoretically be dealt (and completed) more than once for
  // the same user across different days — keep the most recent completion.
  const latestByPlaceId = new Map<string, (typeof completedCards)[number]>();
  for (const card of completedCards) {
    if (card.status !== "completed") continue;
    const existing = latestByPlaceId.get(card.placeId);
    if (!existing || (card.completedAt ?? "") > (existing.completedAt ?? "")) {
      latestByPlaceId.set(card.placeId, card);
    }
  }

  const cells: CollectionCell[] = allPlaces.map((place) => {
    const card = latestByPlaceId.get(place.id);
    if (!card) {
      return {
        placeId: place.id,
        placeName: place.name,
        completed: false,
        cardId: null,
        reason: null,
        dare: null,
        rarityTier: null,
        viaLine: null,
        proofType: null,
        completedAt: null,
      };
    }
    return {
      placeId: place.id,
      placeName: place.name,
      completed: true,
      cardId: card.id,
      reason: card.reason,
      dare: card.dare,
      rarityTier: card.rarityTier as RarityTier,
      viaLine: card.viaLine,
      proofType: card.proofType as "photo" | "honor" | null,
      completedAt: card.completedAt,
    };
  });

  return {
    totalPlaces: allPlaces.length,
    completedCount: latestByPlaceId.size,
    cells,
  };
}
