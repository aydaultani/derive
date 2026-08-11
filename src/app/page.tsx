"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  SpinResponseSchema,
  type Card,
  type SpinRequest,
  type SpinResponse,
} from "@/lib/schemas";
import { getOrCreateUserId, getCurrentStreak, recordCardSeen } from "@/lib/local-user";
import { hasSeenOnboarding } from "@/lib/onboarding";
import { CardReveal } from "@/components/spin/card-reveal";
import { OriginForm } from "@/components/spin/origin-form";
import { LoadingBracket } from "@/components/ui/loading-bracket";
import { SectionTag } from "@/components/ui/section-tag";
import { FilterPanel, useFilters } from "@/components/filters";
import { OnboardingOverlay } from "@/components/onboarding";

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

/** Reads ?onboarding=1 to force-open the walkthrough regardless of the
 * seen-flag — CollectionApp's header links back through this. Isolated in
 * its own component so the `useSearchParams()` suspense requirement
 * doesn't gate the rest of the page behind a fallback. */
function OnboardingQueryTrigger({ onForceOpen }: { onForceOpen: () => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("onboarding") === "1") onForceOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  return null;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [card, setCard] = useState<Card | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const { filters, setFilters } = useFilters();

  // On mount: returning visitors with a card already dealt today see it
  // immediately instead of being offered a fresh spin. First-time
  // visitors (no `derive:onboarded` flag yet) get the walkthrough — this
  // doesn't block the today's-card fetch, both resolve independently.
  useEffect(() => {
    let cancelled = false;
    const userId = getOrCreateUserId();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (!hasSeenOnboarding()) {
      // Deliberate: only reachable once on mount (hasSeenOnboarding reads
      // localStorage, not React state), so this can't cascade — matches
      // the same disable pattern used in use-filters.ts's hydration effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowOnboarding(true);
    }

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

    const response = await postSpin({ userId, origin, timezone, filters });

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
      <Suspense fallback={null}>
        <OnboardingQueryTrigger onForceOpen={() => setShowOnboarding(true)} />
      </Suspense>

      {showOnboarding ? <OnboardingOverlay onClose={() => setShowOnboarding(false)} /> : null}

      <header className="chrome flex w-full max-w-sm items-center justify-between border-b border-ground-line px-5 py-5 text-[11px] text-platform-dim">
        <div className="flex items-center gap-3">
          <span className="text-platform tracking-[0.15em]">DERIVE</span>
          <button
            type="button"
            onClick={() => setShowOnboarding(true)}
            aria-label="How DERIVE works"
            className="flex h-4 w-4 items-center justify-center rounded-full border border-ground-line text-[10px] text-platform-dim hover:border-platform-dim hover:text-platform"
          >
            ?
          </button>
        </div>
        <Link
          href="/collection"
          className="chrome text-[11px] text-platform-dim underline decoration-dotted underline-offset-4 hover:text-platform"
        >
          Collection
        </Link>
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
          <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 text-center">
            <div className="flex flex-col items-center gap-2">
              <SectionTag>One spin a day.</SectionTag>
              <p className="max-w-[280px] text-[13px] leading-snug text-platform-dim">
                Enter a NYC address or ZIP. DERIVE deals a real place, reachable by
                subway, with a dare attached — go before midnight or the card expires.
              </p>
            </div>
            <OriginForm onSubmit={handleSpin} pending={false} errorMessage={errorMessage} />

            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="chrome text-[11px] text-platform-dim underline decoration-dotted underline-offset-4 hover:text-platform"
            >
              {showFilters ? "Hide filters" : "Filters"}
            </button>

            {showFilters ? (
              <div className="w-full max-w-sm border border-ground-line text-left">
                <FilterPanel onFiltersChange={setFilters} />
              </div>
            ) : null}
          </div>
        )}

        {phase === "spinning" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <OriginForm onSubmit={handleSpin} pending errorMessage={null} />
          </div>
        )}

        {phase === "revealed" && card && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <SectionTag>Card dealt.</SectionTag>
            <CardReveal
              key={card.id}
              card={card}
              proofHref={proofHrefFor(card.id)}
              transfers={card.transfers}
              placeLat={card.placeLat}
              placeLon={card.placeLon}
            />
          </div>
        )}
      </main>
    </div>
  );
}
