"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/lib/schemas";
import { lineColor } from "@/lib/mta-lines";
import { prefersReducedMotion } from "@/components/ui/use-reduced-motion";
import { DitherField, readDitherDensity } from "./dither-field";
import { CardDisplay } from "./card-display";

export interface CardRevealProps {
  card: Card;
  proofHref: string;
  transfers?: number;
  placeLat?: number;
  placeLon?: number;
}

/**
 * Orchestrates the ~3s reveal: dither field resolves (handled internally by
 * DitherField) → line-color bleeds in behind the name plate → name & copy
 * set last. Staging is driven by CSS `animation` with delays/durations
 * expressed as `calc(var(--reveal-duration) * fraction)`, so tuning the
 * token in globals.css re-times this automatically, and
 * `prefers-reduced-motion` (which both zeroes the token and forces
 * near-zero animation durations globally) collapses it to the final state.
 *
 * Mount this with `key={card.id}` from the caller so a new card replays
 * the sequence instead of reusing stale animation state.
 */
export function CardReveal({ card, proofHref, transfers, placeLat, placeLon }: CardRevealProps) {
  const tint = lineColor(card.viaLine);
  const [density] = useState(() => readDitherDensity(card.rarityTier));

  // Reduced-motion starts already "staged" (final state, no animation to
  // kick off). Otherwise, flip to staged one frame after mount so the CSS
  // animation has a real transition target rather than firing on the
  // element's very first paint.
  const [staged, setStaged] = useState(prefersReducedMotion);
  useEffect(() => {
    if (staged) return;
    const raf = requestAnimationFrame(() => setStaged(true));
    return () => cancelAnimationFrame(raf);
  }, [staged]);

  return (
    <div className="w-full max-w-sm">
      <style>{`
        @keyframes derive-bleed-in {
          from { opacity: 0; transform: scaleX(0.5); }
          to { opacity: 1; transform: scaleX(1); }
        }
        @keyframes derive-set-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="border border-ground-line bg-ground-raised px-5 py-6">
        <DitherField density={density} seed={card.id} className="mb-6" />

        <div
          aria-hidden="true"
          className="mx-auto h-1.5 w-20"
          style={
            staged
              ? {
                  background: tint,
                  animation:
                    "derive-bleed-in calc(var(--reveal-duration) * 0.267) ease-out calc(var(--reveal-duration) * 0.4) both",
                }
              : { background: tint, opacity: 0 }
          }
        />

        <div
          style={
            staged
              ? {
                  animation:
                    "derive-set-in calc(var(--reveal-duration) * 0.333) ease-out calc(var(--reveal-duration) * 0.667) both",
                }
              : { opacity: 0 }
          }
        >
          <CardDisplay
            card={card}
            tint={tint}
            proofHref={proofHref}
            transfers={transfers}
            placeLat={placeLat}
            placeLon={placeLon}
            className="mt-6"
          />
        </div>
      </div>
    </div>
  );
}
