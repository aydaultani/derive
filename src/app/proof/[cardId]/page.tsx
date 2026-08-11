import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ProofCapture } from "@/components/proof";
import { db } from "@/db/client";
import { cards } from "@/db/schema";

/**
 * Proof entry point linked from the card reveal's "I WENT →" button. The
 * ui-core track is choosing that link's target in parallel — if it lands on
 * a different path than `/proof/[cardId]`, this is a one-line fix on their
 * end to match.
 */
export default async function ProofPage({ params }: PageProps<"/proof/[cardId]">) {
  const { cardId } = await params;

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) notFound();

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-6 bg-ground p-4 text-platform">
      <header className="flex flex-col gap-1">
        <p className="chrome text-[11px] text-platform-dim">Proof of visit</p>
        <h1 className="font-display text-3xl">{card.name}</h1>
        <p className="chrome text-[11px] text-platform-dim">{card.dare}</p>
      </header>

      {card.status === "completed" ? (
        <div className="flex flex-col items-center gap-2 rounded border border-ground-line bg-ground-raised p-6 text-center">
          <p className="chrome text-sm text-platform">Already marked complete</p>
          <p className="chrome text-[11px] text-platform-dim">
            {card.proofType === "photo" ? "Photo-verified." : "Honor system — no photo."}
          </p>
          <a href="/collection" className="chrome text-[11px] text-platform underline decoration-dotted underline-offset-2">
            View your collection →
          </a>
        </div>
      ) : card.status === "expired" ? (
        <p className="chrome text-[11px] text-danger">This card expired at local midnight — no more proof submissions.</p>
      ) : (
        <ProofCapture cardId={card.id} placeName={card.name} />
      )}
    </main>
  );
}
