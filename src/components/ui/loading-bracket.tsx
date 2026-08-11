/**
 * Signage-register loading indicator: bracket-notation progress in the
 * agnost.ai register, not a spinner glyph. Used while a spin is in flight.
 * Its animation duration is a plain constant — the global
 * `prefers-reduced-motion` rule in globals.css forces every animation /
 * transition duration to ~0 regardless of source, so this collapses to a
 * static bracket automatically.
 */
export function LoadingBracket({ label = "ROLLING" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="chrome flex items-center gap-2 text-[11px] text-platform-dim"
    >
      <span aria-hidden="true" className="derive-loading-bracket">
        [<span className="derive-loading-bracket-fill">====</span>------]
      </span>
      <span>{label}…</span>
      <style>{`
        .derive-loading-bracket-fill {
          display: inline-block;
          animation: derive-bracket-slide 1.1s ease-in-out infinite;
        }
        @keyframes derive-bracket-slide {
          0% { opacity: 0.35; transform: translateX(0); }
          50% { opacity: 1; transform: translateX(2px); }
          100% { opacity: 0.35; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
