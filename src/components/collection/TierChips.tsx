"use client";

export type TierFilter = "all" | "common" | "rare_plus" | "mine";

const OPTIONS: { value: TierFilter; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "common", label: "COMMON" },
  { value: "rare_plus", label: "RARE+" },
  { value: "mine", label: "MINE" },
];

interface TierChipsProps {
  value: TierFilter;
  onChange: (value: TierFilter) => void;
}

export function TierChips({ value, onChange }: TierChipsProps) {
  return (
    <div className="flex gap-2 border-b border-ground-line px-4 py-3">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`chrome rounded-full border px-3 py-1 text-[11px] transition-colors ${
            value === opt.value
              ? "border-platform bg-ground-line text-platform"
              : "border-ground-line text-platform-dim hover:text-platform"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
