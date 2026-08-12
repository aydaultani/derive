"use client";

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

/** A binary filter switch (indoor only, step-free only, open now). */
export function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="flex flex-col gap-0.5">
        <span className="chrome text-[11px] text-platform">{label}</span>
        {hint ? (
          <span className="chrome text-[10px] normal-case tracking-normal text-platform-faint">{hint}</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-all duration-150 hover:scale-[1.04] active:scale-95 ${
          checked ? "border-platform bg-platform-dim" : "border-ground-line bg-ground-raised"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ground transition-transform ${
            checked ? "translate-x-6 bg-ground" : "translate-x-0.5 bg-platform-faint"
          }`}
        />
      </button>
    </label>
  );
}
