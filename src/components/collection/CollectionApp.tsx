"use client";

import { useEffect, useState } from "react";
import { CardDetailModal } from "./CardDetailModal";
import { CollectionGrid } from "./CollectionGrid";
import type { CollectionCell, CollectionData } from "./get-collection";
import { TierChips, type TierFilter } from "./TierChips";

/** Same per-browser id convention as `src/components/proof/ProofCapture.tsx`
 * — see the note there. `/collection` has no server-side way to know which
 * user is asking (no accounts, no cookies), so this has to be a client
 * fetch off the localStorage id rather than a server-component DB read. */
function getOrCreateLocalUserId(): string {
  const KEY = "derive:userId";
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  window.localStorage.setItem(KEY, fresh);
  return fresh;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: CollectionData };

export function CollectionApp() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [tier, setTier] = useState<TierFilter>("all");
  const [selected, setSelected] = useState<CollectionCell | null>(null);

  useEffect(() => {
    const userId = getOrCreateLocalUserId();
    fetch(`/api/collection?userId=${encodeURIComponent(userId)}`)
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
      <header className="chrome flex items-center justify-between px-4 py-4 text-xs">
        <span>DERIVE / COLLECTION</span>
        <span>
          {state.phase === "ready" ? `${state.data.completedCount} / ${state.data.totalPlaces}` : "— / —"}
        </span>
      </header>

      {state.phase === "loading" ? (
        <p className="chrome p-6 text-center text-[11px] text-platform-dim">Loading your collection…</p>
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
