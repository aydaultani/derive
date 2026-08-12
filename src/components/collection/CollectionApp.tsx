"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getOrCreateUserId, getOrCreateUserSecret } from "@/lib/local-user";
import { SectionTag } from "@/components/ui/section-tag";
import { CardDetailModal } from "./CardDetailModal";
import { CollectionGrid } from "./CollectionGrid";
import type { CollectionCell, CollectionData } from "./get-collection";
import { TierChips, type TierFilter } from "./TierChips";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: CollectionData };

export function CollectionApp() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [tier, setTier] = useState<TierFilter>("all");
  const [selected, setSelected] = useState<CollectionCell | null>(null);

  useEffect(() => {
    const userId = getOrCreateUserId();
    fetch(`/api/collection?userId=${encodeURIComponent(userId)}`, {
      headers: { "x-derive-user-secret": getOrCreateUserSecret() },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((data: CollectionData) => setState({ phase: "ready", data }))
      .catch((err: unknown) => {
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : "Couldn't load your collection.",
        });
      });
  }, []);

  return (
    <main className="flex min-h-full flex-col bg-ground text-platform">
      <header className="chrome flex items-center justify-between border-b border-ground-line px-4 py-4 text-xs">
        <div className="flex items-center gap-3">
          <span>DERIVE / COLLECTION</span>
          <Link
            href="/?onboarding=1"
            className="text-[10px] text-platform-dim underline decoration-dotted underline-offset-4 hover:text-platform"
          >
            How this works
          </Link>
        </div>
        <span>
          {state.phase === "ready" ? `${state.data.completedCount} / ${state.data.totalPlaces}` : "— / —"}
        </span>
      </header>

      {state.phase === "loading" ? (
        <div className="p-6">
          <SectionTag>Loading your collection…</SectionTag>
        </div>
      ) : state.phase === "error" ? (
        <p className="chrome p-6 text-center text-[11px] text-danger">{state.message}</p>
      ) : (
        <>
          <TierChips value={tier} onChange={setTier} />
          <CollectionGrid cells={state.data.cells} tier={tier} onSelectCell={setSelected} />
          <footer className="chrome mt-auto border-t border-ground-line px-4 py-3 text-[10px] normal-case tracking-normal text-platform-dim">
            Tap a lit card for the story. Greyed cards are still locked.
          </footer>
        </>
      )}

      {selected ? <CardDetailModal cell={selected} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}
