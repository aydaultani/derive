"use client";

import { lineColor } from "@/lib/mta-lines";
import type { CollectionCell } from "./get-collection";

interface CardDetailModalProps {
  cell: CollectionCell;
  onClose: () => void;
}

/** Tapping a lit cell shows the card's story — kept to a simple overlay. */
export function CardDetailModal({ cell, onClose }: CardDetailModalProps) {
  const tint = lineColor(cell.viaLine);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-sm flex-col gap-3 rounded border border-ground-line bg-ground-raised p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-2xl" style={{ color: tint }}>
            {cell.placeName}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="chrome text-platform-dim">
            ×
          </button>
        </div>

        <p className="chrome text-[11px] text-platform-dim">
          {cell.rarityTier ?? "unknown"} · {cell.proofType === "honor" ? "honor system" : "photo verified"}
        </p>

        {cell.reason ? <p className="text-sm text-platform">&ldquo;{cell.reason}&rdquo;</p> : null}

        {cell.dare ? (
          <div className="flex flex-col gap-1 border-t border-ground-line pt-2">
            <p className="chrome text-[10px] text-platform-dim">Dare</p>
            <p className="text-sm text-platform">{cell.dare}</p>
          </div>
        ) : null}

        {cell.completedAt ? (
          <p className="chrome text-[10px] text-platform-faint">
            Completed {new Date(cell.completedAt).toLocaleDateString()}
          </p>
        ) : null}
      </div>
    </div>
  );
}
