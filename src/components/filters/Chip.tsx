"use client";

interface ChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

/** A single pill/chip — the atomic unit of every filter row. */
export function Chip({ label, selected, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`chrome shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        selected
          ? "border-platform bg-ground-line text-platform"
          : "border-ground-line bg-transparent text-platform-dim hover:border-platform-faint hover:text-platform"
      }`}
    >
      {label}
    </button>
  );
}

interface ChipRowProps<T extends string | number> {
  legend: string;
  options: { value: T; label: string }[];
  /** For single-select rows pass a single-element array as `value`; the
   * row still renders as a chip group either way. */
  value: T[];
  onToggle: (value: T) => void;
  hint?: string;
}

/** A labeled row of chips — used for both multi-select (boroughs,
 * categories) and single-select (rarity floor, budget, time of day) rows;
 * the caller controls select-one-vs-many semantics via `onToggle`. */
export function ChipRow<T extends string | number>({ legend, options, value, onToggle, hint }: ChipRowProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="chrome text-[11px] text-platform-dim">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            selected={value.includes(opt.value)}
            onClick={() => onToggle(opt.value)}
          />
        ))}
      </div>
      {hint ? <p className="chrome text-[10px] normal-case tracking-normal text-platform-faint">{hint}</p> : null}
    </fieldset>
  );
}
