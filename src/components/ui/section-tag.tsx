import type { ReactNode } from "react";

/**
 * "+Label+" chrome tag — the flanking plus-marks read from agnost.ai's
 * section eyebrows ("+Features+"). Used for short state/section labels
 * throughout the app in place of bare text.
 */
export function SectionTag({ children }: { children: ReactNode }) {
  return (
    <p className="chrome flex items-center justify-center gap-1.5 text-[11px] text-platform-dim">
      <span aria-hidden="true" className="text-platform-faint">
        +
      </span>
      {children}
      <span aria-hidden="true" className="text-platform-faint">
        +
      </span>
    </p>
  );
}
