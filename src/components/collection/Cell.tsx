"use client";

import { lineColor } from "@/lib/mta-lines";
import type { CollectionCell } from "./get-collection";
import { GHOST_DITHER_DENSITY, TIER_DITHER_DENSITY, seededDitherGrid } from "./dither";

interface CellProps {
  cell: CollectionCell;
  onSelect: (cell: CollectionCell) => void;
}

/** One grid square: lit + line-tinted + tier-dense dither when completed,
 * greyed and ghost-sparse when not. Honor completions get a dotted border,
 * photo-verified ones solid — same tint, visibly different provenance. */
export function Cell({ cell, onSelect }: CellProps) {
  const density = cell.completed && cell.rarityTier ? TIER_DITHER_DENSITY[cell.rarityTier] : GHOST_DITHER_DENSITY;
  const glyphRows = seededDitherGrid(cell.placeId, density);
  const tint = cell.completed ? lineColor(cell.viaLine) : null;
  const borderStyle = cell.completed && cell.proofType === "honor" ? "dotted" : "solid";

  return (
    <button
      type="button"
      onClick={() => cell.completed && onSelect(cell)}
      aria-label={cell.completed ? `${cell.placeName} — completed` : "Not yet completed"}
      disabled={!cell.completed}
      className="aspect-square w-full overflow-hidden rounded-sm p-0.5 transition-transform disabled:cursor-default enabled:hover:scale-[1.03] enabled:active:scale-95"
      style={{
        borderWidth: 1,
        borderStyle,
        borderColor: tint ?? "var(--ground-line)",
        backgroundColor: tint ? `${tint}26` : "var(--ground-raised)",
      }}
    >
      <div
        className="font-mono leading-none whitespace-pre select-none"
        style={{
          fontSize: "5px",
          color: tint ?? "var(--platform-faint)",
          opacity: cell.completed ? 0.9 : 0.35,
        }}
      >
        {glyphRows.join("\n")}
      </div>
    </button>
  );
}
