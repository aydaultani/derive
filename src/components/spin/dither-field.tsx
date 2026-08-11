"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrefersReducedMotion } from "@/components/ui/use-reduced-motion";

/**
 * The signature visual: a text-grid whose proportion of dense-vs-sparse
 * glyphs matches a rarity tier's `--dither-{tier}` density token (0-1).
 * Pure CSS grid + text, no canvas — density is a *character mix*, not a
 * gradient or glow (per CONTRACT.md).
 */

const DENSE_GLYPHS = ["▓", "█"];
const SPARSE_GLYPHS = [" ", "░"];

// The dither field "resolves from noise" during roughly the first 40% of
// the reveal sequence (~1200ms of a 3000ms --reveal-duration, per the
// CONTRACT.md wireframe timing).
const RESOLVE_FRACTION = 0.4;
const NOISE_FRAME_MS = 90;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickGlyph(rand: () => number, density: number): string {
  if (rand() < density) {
    return rand() < density ? DENSE_GLYPHS[1] : DENSE_GLYPHS[0];
  }
  return rand() < density * 0.6 ? SPARSE_GLYPHS[1] : SPARSE_GLYPHS[0];
}

function buildGrid(seed: number, density: number, cellCount: number): string[] {
  const rand = mulberry32(seed);
  return Array.from({ length: cellCount }, () => pickGlyph(rand, density));
}

const FALLBACK_DENSITY: Record<string, number> = {
  common: 0.12,
  uncommon: 0.28,
  rare: 0.48,
  epic: 0.72,
  legendary: 0.94,
};

/**
 * Reads `--dither-{tier}` straight from the design tokens in globals.css
 * (getComputedStyle) rather than re-declaring the density numbers here, so
 * the token and this component can never drift apart. Falls back to a
 * mirrored table only if the token is unreadable (no DOM / var missing).
 */
export function readDitherDensity(tier: string): number {
  if (typeof window === "undefined") return FALLBACK_DENSITY[tier] ?? 0.3;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--dither-${tier}`)
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : (FALLBACK_DENSITY[tier] ?? 0.3);
}

function readRevealDurationMs(): number {
  if (typeof window === "undefined") return 3000;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--reveal-duration")
    .trim();
  const match = /^([\d.]+)(ms|s)?$/.exec(raw);
  if (!match) return 3000;
  const value = Number.parseFloat(match[1]);
  return match[2] === "s" ? value * 1000 : value;
}

export interface DitherFieldProps {
  /** Density 0-1, e.g. from `readDitherDensity(card.rarityTier)`. */
  density: number;
  /** Stable per-card seed (card id) so the resolved pattern is reproducible. */
  seed: string;
  cols?: number;
  rows?: number;
  className?: string;
}

export function DitherField({ density, seed, cols = 26, rows = 6, className }: DitherFieldProps) {
  const reducedMotion = usePrefersReducedMotion();
  const cellCount = cols * rows;
  const finalSeed = useMemo(() => hashString(seed), [seed]);
  const finalGrid = useMemo(
    () => buildGrid(finalSeed, density, cellCount),
    [finalSeed, density, cellCount],
  );

  const [grid, setGrid] = useState<string[]>(() =>
    reducedMotion ? finalGrid : buildGrid(finalSeed ^ 0x9e3779b9, density, cellCount),
  );
  const [settled, setSettled] = useState(reducedMotion);

  useEffect(() => {
    // Reduced motion: initial state above is already the settled final
    // grid, so there's nothing left to animate.
    if (reducedMotion) return;

    const resolveMs = readRevealDurationMs() * RESOLVE_FRACTION;
    let frame = 0;
    const totalFrames = Math.max(1, Math.round(resolveMs / NOISE_FRAME_MS));
    const interval = window.setInterval(() => {
      frame += 1;
      if (frame >= totalFrames) {
        window.clearInterval(interval);
        setGrid(finalGrid);
        setSettled(true);
        return;
      }
      setGrid(buildGrid(finalSeed + frame * 97, density, cellCount));
    }, NOISE_FRAME_MS);

    return () => window.clearInterval(interval);
  }, [finalSeed, finalGrid, density, cellCount, reducedMotion]);

  return (
    <div
      aria-hidden="true"
      data-settled={settled ? "true" : "false"}
      className={`grid select-none gap-y-px ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {grid.map((glyph, i) => (
        <span
          key={i}
          className="text-center leading-none text-platform-dim transition-opacity"
          style={{ opacity: settled ? 1 : 0.65, fontSize: "11px" }}
        >
          {glyph}
        </span>
      ))}
    </div>
  );
}
