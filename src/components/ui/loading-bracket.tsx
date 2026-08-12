"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/components/ui/use-reduced-motion";

// Same ▓ █ ░ vocabulary as the card-reveal DitherField, so every "please
// wait" moment in the app reads as the same visual language: flickering
// noise here, noise that *resolves* there.
const GLYPHS = ["▓", "█", "░", " ", "░"];
const NOISE_COLS = 14;
const NOISE_FRAME_MS = 120;

function randomRow(): string[] {
  return Array.from({ length: NOISE_COLS }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]);
}

/**
 * Signage-register loading indicator: a flickering pixel-noise strip plus
 * bracket-notation progress, not a spinner glyph. Used while a spin is in
 * flight or while checking for today's already-dealt card. The bracket
 * animation's duration is a plain constant: the global
 * `prefers-reduced-motion` rule in globals.css forces every animation /
 * transition duration to ~0 regardless of source. The noise strip
 * uses JS state, though, so it's frozen to a static row explicitly below.
 */
export function LoadingBracket({ label = "ROLLING" }: { label?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  // Deterministic placeholder so server and client render identical markup
  // on first paint — randomRow() picks glyphs via Math.random(), so seeding
  // useState with it directly would mismatch between SSR and hydration.
  // The real noise (or, under reduced motion, one static random-looking
  // frame) is only ever set client-side, in the effect below.
  const [row, setRow] = useState<string[]>(() => Array(NOISE_COLS).fill("░"));

  useEffect(() => {
    setRow(randomRow());
    if (reducedMotion) return;
    const interval = window.setInterval(() => setRow(randomRow()), NOISE_FRAME_MS);
    return () => window.clearInterval(interval);
  }, [reducedMotion]);

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
      <div aria-hidden="true" className="flex gap-px text-[11px] leading-none text-platform-dim">
        {row.map((glyph, i) => (
          <span key={i}>{glyph}</span>
        ))}
      </div>
      <div className="chrome flex items-center gap-2 text-[11px] text-platform-dim">
        <span aria-hidden="true" className="derive-loading-bracket">
          [<span className="derive-loading-bracket-fill">====</span>------]
        </span>
        <span>{label}…</span>
      </div>
      <style>{`
        .derive-loading-bracket-fill {
          display: inline-block;
          animation: derive-bracket-slide 1.1s ease-in-out infinite;
        }
        @keyframes derive-bracket-slide {
          0% { opacity: 0.35; transform: translateX(0); }
          50% { opacity: 1; transform: translateX(2px); }
          100% { opacity: 0.35; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
