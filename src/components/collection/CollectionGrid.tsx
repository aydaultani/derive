"use client";

import { Cell } from "./Cell";
import type { CollectionCell } from "./get-collection";
import type { TierFilter } from "./TierChips";

function matchesTier(cell: CollectionCell, filter: TierFilter): boolean {
  if (filter === "all") return true;
  if (!cell.completed || !cell.rarityTier) return false;
  if (filter === "mine") return true;
  if (filter === "common") return cell.rarityTier === "common";
  // rare_plus
  return cell.rarityTier === "rare" || cell.rarityTier === "epic" || cell.rarityTier === "legendary";
}

interface CollectionGridProps {
  cells: CollectionCell[];
  tier: TierFilter;
  onSelectCell: (cell: CollectionCell) => void;
}

export function CollectionGrid({ cells, tier, onSelectCell }: CollectionGridProps) {
  // MINE densifies the view down to just what you've completed; ALL /
  // COMMON / RARE+ keep the full universe laid out (so the grid always
  // communicates scale) and grey out cells that don't match the tier.
  const visible = tier === "mine" ? cells.filter((c) => c.completed) : cells;

  if (visible.length === 0) {
    return (
      <p className="chrome p-6 text-center text-[11px] text-platform-dim">
        Nothing here yet — go spin.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-6 gap-1.5 p-3 sm:grid-cols-8">
      {visible.map((cell) => {
        const dimmedByFilter = !matchesTier(cell, tier);
        const effectiveCell = dimmedByFilter ? { ...cell, completed: false } : cell;
        return <Cell key={cell.placeId} cell={effectiveCell} onSelect={onSelectCell} />;
      })}
    </div>
  );
}
