"use client";

import {
  BOROUGHS,
  BUDGET_TIERS,
  CATEGORIES,
  DEFAULT_FILTERS,
  RARITY_TIERS,
  TIME_WINDOWS,
  type Borough,
  type BudgetTier,
  type Category,
  type Filters,
  type RarityTier,
  type TimeWindow,
} from "@/lib/schemas";
import { ChipRow } from "./Chip";
import { BUDGET_LABELS, RARITY_LABELS, TIME_WINDOW_HINTS, TIME_WINDOW_LABELS, titleCase } from "./labels";
import { PoolSizeWarning } from "./PoolSizeWarning";
import { Toggle } from "./Toggle";
import { usePoolSize } from "./use-pool-size";

const TRAVEL_OPTIONS: { value: Filters["maxTravelMinutes"]; label: string }[] = [
  { value: 15, label: "15 MIN" },
  { value: 30, label: "30 MIN" },
  { value: 45, label: "45 MIN" },
  { value: 60, label: "60 MIN" },
  { value: "any", label: "ANY" },
];

const BOROUGH_OPTIONS = BOROUGHS.map((b) => ({ value: b, label: titleCase(b) }));
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }));
const RARITY_OPTIONS = RARITY_TIERS.map((r) => ({ value: r, label: RARITY_LABELS[r] }));
const BUDGET_OPTIONS = BUDGET_TIERS.map((b) => ({ value: b, label: BUDGET_LABELS[b] }));
const TIME_WINDOW_OPTIONS = TIME_WINDOWS.map((t) => ({ value: t, label: TIME_WINDOW_LABELS[t] }));

interface FilterPanelProps {
  /** Controlled: the parent (page.tsx) owns the single `useFilters()`
   * instance backing both the spin request and this panel's persisted
   * localStorage state. FilterPanel used to call its own separate
   * `useFilters()` — two independent instances racing on the same
   * `derive:filters` key, whichever set last silently clobbering the
   * other's in-memory state (not just a display glitch: a chip clicked
   * right after the panel opened could compute its patch off a
   * not-yet-hydrated DEFAULT_FILTERS and stomp everything the parent had
   * already set). Controlled props make the parent the only writer. */
  filters: Filters;
  onChange: (filters: Filters) => void;
  hydrated: boolean;
}

export function FilterPanel({ filters, onChange, hydrated }: FilterPanelProps) {
  const { poolSize, warning, loading } = usePoolSize(filters, hydrated);

  const update = (patch: Partial<Filters>) => {
    onChange({ ...filters, ...patch });
  };

  const toggleMulti = <K extends "boroughs" | "categories">(key: K, value: Filters[K][number]) => {
    const current = filters[key] as unknown as string[];
    const exists = current.includes(value);
    const nextList = exists ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...filters, [key]: nextList });
  };

  const isDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <section className="flex flex-col gap-5 bg-ground p-4 text-platform">
      <header className="flex items-center justify-between">
        <h2 className="chrome text-xs text-platform">Filters</h2>
        {isDirty ? (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="chrome text-[10px] text-platform-dim underline decoration-dotted underline-offset-2 hover:text-platform"
          >
            Reset
          </button>
        ) : null}
      </header>

      <ChipRow
        legend="Max travel time"
        options={TRAVEL_OPTIONS}
        value={[filters.maxTravelMinutes]}
        onToggle={(v) => update({ maxTravelMinutes: v })}
      />

      <ChipRow<Borough>
        legend="Boroughs (none = all)"
        options={BOROUGH_OPTIONS}
        value={filters.boroughs}
        onToggle={(v) => toggleMulti("boroughs", v)}
      />

      <ChipRow<Category>
        legend="Categories (none = all)"
        options={CATEGORY_OPTIONS}
        value={filters.categories}
        onToggle={(v) => toggleMulti("categories", v)}
      />

      <ChipRow<RarityTier>
        legend="Rarity floor"
        options={RARITY_OPTIONS}
        value={[filters.rarityFloor]}
        onToggle={(v) => update({ rarityFloor: v })}
        hint="Applied after the roll — narrows which tier you're guaranteed at least."
      />

      <ChipRow<BudgetTier>
        legend="Budget"
        options={BUDGET_OPTIONS}
        value={[filters.budget]}
        onToggle={(v) => update({ budget: v })}
      />

      <ChipRow<TimeWindow>
        legend="Time of day"
        options={TIME_WINDOW_OPTIONS}
        value={[filters.timeOfDay]}
        onToggle={(v) => update({ timeOfDay: v })}
        hint={TIME_WINDOW_HINTS[filters.timeOfDay] || "Some cards only deal at sunrise or after 10PM."}
      />

      <div className="flex flex-col gap-1 border-t border-ground-line pt-3">
        <Toggle label="Open now" checked={filters.openNow} onChange={(v) => update({ openNow: v })} hint="Skips places with unknown hours." />
        <Toggle label="Indoors only" checked={filters.indoorOnly} onChange={(v) => update({ indoorOnly: v })} />
        <Toggle label="Step-free only" checked={filters.stepFreeOnly} onChange={(v) => update({ stepFreeOnly: v })} hint="Nearest station has an elevator/escalator." />
      </div>

      <PoolSizeWarning poolSize={poolSize} warning={warning} loading={loading} />
    </section>
  );
}
