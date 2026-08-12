"use client";

import { lineColor } from "@/lib/mta-lines";
import type { CollectionCell } from "./get-collection";
import { GHOST_DITHER_DENSITY, TIER_DITHER_DENSITY, seededDitherGrid } from "./dither";

interface CellProps {
  cell: CollectionCell;
  onSelect: (cell: CollectionCell) => void;
}

/** Deterministic per-cell stagger so the grid "resolves in" as a wave
 * instead of ~800 cells popping in at once, and so lit cells twinkle out
 * of phase with each other rather than in a synchronized strobe. */
function hashToRange(id: string, max: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % max;
}

/** One grid square: lit + line-tinted + tier-dense dither when completed,
 * greyed and ghost-sparse when not. Honor completions get a dotted border,
 * photo-verified ones solid — same tint, visibly different provenance. */
export function Cell({ cell, onSelect }: CellProps) {
  const density = cell.completed && cell.rarityTier ? TIER_DITHER_DENSITY[cell.rarityTier] : GHOST_DITHER_DENSITY;
  const glyphRows = seededDitherGrid(cell.placeId, density);
  const tint = cell.completed ? lineColor(cell.viaLine) : null;
  const borderStyle = cell.completed && cell.proofType === "honor" ? "dotted" : "solid";
  const resolveDelayMs = hashToRange(cell.placeId, 260);
  const twinkleDelayMs = hashToRange(`${cell.placeId}:twinkle`, 2000);
  const twinkleDurationMs = 1800 + hashToRange(`${cell.placeId}:duration`, 1400);

  return (
    <button
      type="button"
      onClick={() => cell.completed && onSelect(cell)}
      aria-label={cell.completed ? `${cell.placeName} — completed` : "Not yet completed"}
      disabled={!cell.completed}
      className="derive-resolve-in aspect-square w-full overflow-hidden rounded-sm p-0.5 transition-transform disabled:cursor-default enabled:hover:scale-[1.03] enabled:active:scale-95"
      style={{
        borderWidth: 1,
        borderStyle,
        borderColor: tint ?? "var(--ground-line)",
        backgroundColor: tint ? `${tint}26` : "var(--ground-raised)",
        animationDelay: `${resolveDelayMs}ms`,
      }}
    >
      <div
        className={`font-mono leading-none whitespace-pre select-none ${cell.completed ? "derive-twinkle" : ""}`}
        style={{
          fontSize: "5px",
          color: tint ?? "var(--platform-faint)",
          opacity: cell.completed ? 0.9 : 0.35,
          ...(cell.completed
            ? { animationDelay: `${twinkleDelayMs}ms`, animationDuration: `${twinkleDurationMs}ms` }
            : {}),
        }}
      >
        {glyphRows.join("\n")}
      </div>
    </button>
  );
}
