"use client";

import { useMemo, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/components/ui/use-reduced-motion";

/**
 * The "spinning" moment for a freshly dealt card: a gold vault door parts
 * down the middle and a handful of bills spill out before settling. Replaces
 * DitherField for this one call site only — DitherField itself stays
 * untouched (loading-bracket.tsx and onboarding/steps.tsx still use it).
 *
 * Timed the same way the rest of the reveal sequence is: the door-open +
 * bill-rise motion runs over the first `RESOLVE_FRACTION` of
 * `--reveal-duration` (or `revealDurationMs`, when the caller scopes it
 * locally), then holds — matching DitherField's "resolves, then holds"
 * shape so the two visuals used to feel timed the same way before this swap.
 */

const RESOLVE_FRACTION = 0.4;

const GOLD_BRIGHT = "#f5d67b";
const GOLD = "#c9a227";
const GOLD_DEEP = "#7a5a10";
const HUB_INK = "#2a2000";
const BILL_GREEN = "#7a9c5f";
const BILL_GREEN_DARK = "#3f5630";
const BILL_INK = "#eef4e6";

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

const MIN_BILLS = 2;
const MAX_BILLS = 7;

interface Bill {
  leftPct: number;
  rotateDeg: number;
  riseDelayFrac: number;
  driftPx: number;
}

function buildBills(seed: number, density: number): Bill[] {
  const rand = mulberry32(seed);
  const count = Math.round(MIN_BILLS + density * (MAX_BILLS - MIN_BILLS));
  return Array.from({ length: count }, () => ({
    leftPct: 18 + rand() * 64,
    rotateDeg: -26 + rand() * 52,
    riseDelayFrac: rand() * 0.35,
    driftPx: 22 + rand() * 20,
  }));
}

/** Vault door wheel: a ring, radial spokes, and a center hub — drawn once, mirrored per door. */
function DoorWheel({ cx, cy }: { cx: number; cy: number }) {
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    return (
      <line
        key={i}
        x1={cx}
        y1={cy}
        x2={cx + Math.cos(angle) * 13}
        y2={cy + Math.sin(angle) * 13}
        stroke={HUB_INK}
        strokeWidth={1.4}
        opacity={0.55}
      />
    );
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r={19} fill="none" stroke={HUB_INK} strokeWidth={2} opacity={0.55} />
      {spokes}
      <circle cx={cx} cy={cy} r={4} fill={HUB_INK} opacity={0.65} />
    </g>
  );
}

export interface VaultRevealProps {
  /** Stable per-card seed (card id) so the bill arrangement is reproducible. */
  seed: string;
  /** 0-1 rarity density (same value DitherField used) — higher tiers spill more bills. */
  density: number;
  className?: string;
  /** Mirrors CardReveal's override of `--reveal-duration` for this mount. */
  revealDurationMs?: number;
}

export function VaultReveal({ seed, density, className, revealDurationMs }: VaultRevealProps) {
  const reducedMotion = usePrefersReducedMotion();
  const finalSeed = useMemo(() => hashString(seed), [seed]);
  const bills = useMemo(() => buildBills(finalSeed, density), [finalSeed, density]);

  const durationExpr = revealDurationMs !== undefined ? `${revealDurationMs}ms` : "var(--reveal-duration)";
  const openDuration = `calc(${durationExpr} * ${RESOLVE_FRACTION})`;

  return (
    <div
      aria-hidden="true"
      data-settled={reducedMotion ? "true" : undefined}
      className={`relative h-28 overflow-hidden ${className ?? ""}`}
    >
      <style>{`
        @keyframes vault-glow-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 0.9; transform: scale(1); } }
        @keyframes vault-door-left { from { transform: translateX(0); } to { transform: translateX(-58%); } }
        @keyframes vault-door-right { from { transform: translateX(0); } to { transform: translateX(58%); } }
        @keyframes vault-bill-rise {
          0% { opacity: 0; transform: translateY(16px) rotate(var(--bill-rot)) scale(0.55); }
          55% { opacity: 1; }
          100% { opacity: 1; transform: translateY(calc(-1 * var(--bill-drift))) rotate(var(--bill-rot)) scale(1); }
        }
      `}</style>

      {/* gold light spilling from the seam */}
      <div
        className="absolute inset-0 m-auto h-24 w-24 rounded-full"
        style={{
          background: `radial-gradient(circle, ${GOLD_BRIGHT} 0%, ${GOLD} 42%, transparent 70%)`,
          opacity: reducedMotion ? 0.9 : 0,
          animation: reducedMotion ? undefined : `vault-glow-in ${openDuration} ease-out both`,
        }}
      />

      {/* bills spilling out as the door parts */}
      {bills.map((bill, i) => (
        <div
          key={i}
          className="chrome absolute bottom-9 flex h-4 w-7 items-center justify-center rounded-[2px] border text-[8px] font-semibold"
          style={
            {
              left: `${bill.leftPct}%`,
              borderColor: BILL_GREEN_DARK,
              background: BILL_GREEN,
              color: BILL_INK,
              "--bill-rot": `${bill.rotateDeg}deg`,
              "--bill-drift": `${bill.driftPx}px`,
              opacity: reducedMotion ? 1 : 0,
              transform: reducedMotion ? `rotate(${bill.rotateDeg}deg)` : undefined,
              animation: reducedMotion
                ? undefined
                : `vault-bill-rise ${openDuration} cubic-bezier(0.16,1,0.3,1) calc(${durationExpr} * ${bill.riseDelayFrac.toFixed(3)}) both`,
            } as CSSProperties
          }
        >
          $
        </div>
      ))}

      {/* the vault door itself, parting down the middle */}
      <svg viewBox="0 0 200 112" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="vault-door-l" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={GOLD_BRIGHT} />
            <stop offset="100%" stopColor={GOLD_DEEP} />
          </linearGradient>
          <linearGradient id="vault-door-r" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD_BRIGHT} />
            <stop offset="100%" stopColor={GOLD_DEEP} />
          </linearGradient>
        </defs>

        <g
          style={{
            transform: reducedMotion ? "translateX(-58%)" : undefined,
            animation: reducedMotion ? undefined : `vault-door-left ${openDuration} cubic-bezier(0.65,0,0.35,1) both`,
          }}
        >
          <rect x="0" y="0" width="100" height="112" fill="url(#vault-door-l)" />
          <rect x="94" y="0" width="6" height="112" fill={HUB_INK} opacity={0.35} />
          <DoorWheel cx={82} cy={56} />
        </g>

        <g
          style={{
            transform: reducedMotion ? "translateX(58%)" : undefined,
            animation: reducedMotion ? undefined : `vault-door-right ${openDuration} cubic-bezier(0.65,0,0.35,1) both`,
          }}
        >
          <rect x="100" y="0" width="100" height="112" fill="url(#vault-door-r)" />
          <rect x="100" y="0" width="6" height="112" fill={HUB_INK} opacity={0.35} />
          <DoorWheel cx={118} cy={56} />
        </g>
      </svg>
    </div>
  );
}
