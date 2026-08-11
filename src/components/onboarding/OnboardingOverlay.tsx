"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/components/ui/use-reduced-motion";
import { markOnboardingSeen } from "@/lib/onboarding";
import { ONBOARDING_STEPS } from "./steps";

interface OnboardingOverlayProps {
  onClose: () => void;
}

/**
 * Full-screen step-through overlay. One step visible at a time, dot
 * progress (same visual language as the streak dots in page.tsx's
 * header), Escape/Skip to dismiss early. Reduced motion just cuts
 * between steps instead of fading — no animation is load-bearing here.
 */
export function OnboardingOverlay({ onClose }: OnboardingOverlayProps) {
  const [index, setIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const step = ONBOARDING_STEPS[index];
  const isLast = index === ONBOARDING_STEPS.length - 1;

  function finish() {
    markOnboardingSeen();
    onClose();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, ONBOARDING_STEPS.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // finish() closes over fresh state each render; re-subscribing per
    // render is cheap here and keeps Escape correct without a ref dance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How DERIVE works"
      className="fixed inset-0 z-50 flex flex-col bg-ground"
    >
      <header className="chrome flex items-center justify-between px-5 py-5 text-[11px] text-platform-dim">
        <span className="text-platform">DERIVE</span>
        <button
          type="button"
          onClick={finish}
          className="text-platform-dim underline decoration-dotted underline-offset-4 hover:text-platform"
        >
          Skip
        </button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-16">
        <div
          key={reducedMotion ? undefined : index}
          className="flex w-full max-w-sm flex-col items-center gap-5 text-center transition-opacity duration-200"
        >
          <p className="chrome text-[10px] text-platform-faint">{step.eyebrow}</p>
          {step.visual ? <div className="w-full">{step.visual}</div> : null}
          <h2 className="font-display text-3xl leading-tight text-platform">{step.title}</h2>
          <p className="text-[14px] leading-relaxed text-platform-dim">{step.body}</p>
        </div>

        <div className="flex items-center gap-1.5" aria-hidden="true">
          {ONBOARDING_STEPS.map((s, i) => (
            <span
              key={s.eyebrow}
              className="h-1.5 w-1.5 rounded-full transition-colors"
              style={{ backgroundColor: i === index ? "var(--platform)" : "var(--ground-line)" }}
            />
          ))}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-ground-line px-5 py-5">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={index === 0}
          className="chrome px-4 py-3 text-[12px] text-platform-dim disabled:opacity-30"
        >
          ← BACK
        </button>
        <button
          type="button"
          onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
          className="chrome flex-1 border border-platform bg-platform px-5 py-3 text-[12px] font-medium text-ground"
        >
          {isLast ? "START SPINNING →" : "NEXT →"}
        </button>
      </footer>
    </div>
  );
}
