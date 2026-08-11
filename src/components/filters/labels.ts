import type { BudgetTier, RarityTier, TimeWindow } from "@/lib/schemas";

/** `staten_island` -> `Staten Island`, `transit-oddity` -> `Transit Oddity`. */
export function titleCase(value: string): string {
  return value
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const BUDGET_LABELS: Record<BudgetTier, string> = {
  free: "Free",
  under_15: "Under $15",
  any: "Any budget",
};

export const RARITY_LABELS: Record<RarityTier, string> = {
  common: "Common+",
  uncommon: "Uncommon+",
  rare: "Rare+",
  epic: "Epic+",
  legendary: "Legendary",
};

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  any: "Any time",
  sunrise: "Sunrise",
  late_night: "Late night",
};

export const TIME_WINDOW_HINTS: Record<TimeWindow, string> = {
  any: "",
  sunrise: "Only cards that deal at sunrise.",
  late_night: "Only cards that deal after 10PM.",
};
