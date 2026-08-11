"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_FILTERS,
  SpinResponseSchema,
  type Card,
  type SpinRequest,
  type SpinResponse,
} from "@/lib/schemas";
import { getOrCreateUserId, getCurrentStreak, recordCardSeen } from "@/lib/local-user";
import { CardReveal } from "@/components/spin/card-reveal";
import { OriginForm } from "@/components/spin/origin-form";
import { LoadingBracket } from "@/components/ui/loading-bracket";

type Phase = "checking" | "form" | "spinning" | "revealed";

const STREAK_DOTS = 7;

/** Proof-flow entry point picked by ui-core: `/proof/[cardId]`. */
function proofHrefFor(cardId: string): string {
  return `/proof/${cardId}`;
}

async function fetchTodaysCard(userId: string, timezone: string): Promise<Card | null> {
  try {
    const params = new URLSearchParams({ userId, timezone });
    const res = await fetch(`/api/spin?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const raw: unknown = await res.json().catch(() => null);
    if (raw === null) return null;
    const parsed = SpinResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.ok) return parsed.data.card;
    return parsed.data.existingCard ?? null;
  } catch {
    // spin-api route may not exist yet in this worktree, or the network
    // failed — either way, fall through to "offer a fresh spin".
    return null;
  }
}

async function postSpin(payload: SpinRequest): Promise<SpinResponse | null> {
  try {
    const res = await fetch("/api/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw: unknown = await res.json().catch(() => null);
    if (raw === null) return null;
    const parsed = SpinResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [card, setCard] = useState<Card | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);

  // On mount: returning visitors with a card already dealt today see it
  // immediately instead of being offered a fresh spin.
  useEffect(() => {
    let cancelled = false;
    const userId = getOrCreateUserId();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    fetchTodaysCard(userId, timezone).then((existing) => {
      if (cancelled) return;
      setStreak(getCurrentStreak(timezone));
      if (existing) {
        recordCardSeen(existing.dealtDate);
        setStreak(getCurrentStreak(timezone));
        setCard(existing);
        setPhase("revealed");
      } else {
        setPhase("form");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSpin(origin: string) {
    setErrorMessage(null);
    setPhase("spinning");

    const userId = getOrCreateUserId();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const response = await postSpin({ userId, origin, timezone, filters: DEFAULT_FILTERS });

    if (!response) {
      setErrorMessage("Couldn't reach the spin service. Try again.");
      setPhase("form");
      return;
    }

    if (response.ok) {
      recordCardSeen(response.card.dealtDate);
      setStreak(getCurrentStreak(timezone));
      setCard(response.card);
      setPhase("revealed");
      return;
    }

    if (response.error === "already_dealt" && response.existingCard) {
      recordCardSeen(response.existingCard.dealtDate);
      setStreak(getCurrentStreak(timezone));
      setCard(response.existingCard);
      setPhase("revealed");
      return;
    }

    setErrorMessage(response.message || "Card dealt failed. Try again.");
    setPhase("form");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center">
      <header className="chrome flex w-full max-w-sm items-center justify-between px-5 py-5 text-[11px] text-platform-dim">
        <span className="text-platform">DERIVE</span>
        <div className="flex items-center gap-1" aria-label={`Streak: ${streak} day${streak === 1 ? "" : "s"}`}>
          {Array.from({ length: STREAK_DOTS }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: i < streak ? "var(--platform)" : "var(--ground-line)",
              }}
            />
          ))}
        </div>
      </header>

      <main className="flex w-full flex-1 flex-col items-center px-5 pb-16 pt-6">
        {phase === "checking" && (
          <div className="flex flex-1 items-center">
            <LoadingBracket label="CHECKING" />
          </div>
        )}

        {phase === "form" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <p className="chrome text-[11px] text-platform-dim">One spin a day.</p>
            <OriginForm onSubmit={handleSpin} pending={false} errorMessage={errorMessage} />
          </div>
        )}

        {phase === "spinning" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <OriginForm onSubmit={handleSpin} pending errorMessage={null} />
          </div>
        )}

        {phase === "revealed" && card && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <p className="chrome text-[11px] text-platform-dim">Card dealt.</p>
            <CardReveal key={card.id} card={card} proofHref={proofHrefFor(card.id)} />
          </div>
        )}
      </main>
    </div>
  );
}
