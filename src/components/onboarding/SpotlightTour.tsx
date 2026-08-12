"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/components/ui/use-reduced-motion";
import { markOnboardingSeen } from "@/lib/onboarding";
import { TOUR_STEPS } from "./steps";

interface SpotlightTourProps {
  onClose: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

type Side = "top" | "bottom" | "left" | "right" | "center";

/** Padding added around the target's own rect before drawing the cutout. */
const PAD = 6;
/** Gap between the cutout edge and the tooltip callout. */
const GAP = 14;
/** Viewport margin the tooltip never crosses. */
const MARGIN = 12;
/** Rough tooltip footprint used only to pick a side with enough room —
 *  doesn't need to be exact, just enough to avoid picking a cramped side. */
const TOOLTIP_WIDTH = 300;
const TOOLTIP_HEIGHT_ESTIMATE = 200;

/** rgb(24, 24, 27) === --platform (#18181b) from globals.css — the dim
 *  layer intentionally reuses the app's own near-black token rather than a
 *  generic black, so it reads as part of the same theme. */
const DIM_COLOR = "rgba(24, 24, 27, 0.78)";

function measure(target: string): Rect | null {
  const el = document.querySelector(`[data-onboarding="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

function pickSide(rect: Rect): Side {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const spaceBelow = vh - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const spaceRight = vw - (rect.left + rect.width);
  const spaceLeft = rect.left;

  if (spaceBelow >= TOOLTIP_HEIGHT_ESTIMATE) return "bottom";
  if (spaceAbove >= TOOLTIP_HEIGHT_ESTIMATE) return "top";
  if (spaceRight >= TOOLTIP_WIDTH + GAP) return "right";
  if (spaceLeft >= TOOLTIP_WIDTH + GAP) return "left";
  return spaceBelow >= spaceAbove ? "bottom" : "top";
}

function tooltipStyle(rect: Rect | null, side: Side): CSSProperties {
  if (!rect || side === "center") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  const vh = window.innerHeight;
  const vw = window.innerWidth;

  if (side === "bottom" || side === "top") {
    const left = Math.min(Math.max(rect.left, MARGIN), vw - TOOLTIP_WIDTH - MARGIN);
    return side === "bottom"
      ? { top: rect.top + rect.height + GAP, left }
      : { bottom: vh - rect.top + GAP, left };
  }

  const top = Math.min(Math.max(rect.top, MARGIN), vh - TOOLTIP_HEIGHT_ESTIMATE - MARGIN);
  return side === "right"
    ? { top, left: rect.left + rect.width + GAP }
    : { top, right: vw - rect.left + GAP };
}

/**
 * Live coachmark / product tour: dims the viewport except a spotlight cut
 * out around a real element (found via `data-onboarding="<key>"`), with a
 * tooltip callout next to it. Replaces the old full-screen slideshow —
 * every step points at something actually on screen.
 */
export function SpotlightTour({ onClose }: SpotlightTourProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  const finish = useCallback(() => {
    markOnboardingSeen();
    onClose();
  }, [onClose]);

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= TOUR_STEPS.length - 1) return i;
      return i + 1;
    });
  }, []);

  const goBack = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Resolve the current step's target before paint. A step with no target
  // renders a centered callout; a step whose target isn't in the DOM right
  // now (conditionally rendered elsewhere) is skipped forward automatically
  // rather than rendering a spotlight pointing at nothing. If skipping runs
  // off the end of the list, just close the tour.
  useLayoutEffect(() => {
    if (!step) {
      finish();
      return;
    }
    if (step.target === null) {
      // Deliberate: clears any stale rect from a previous, targeted step
      // when this step is a centered callout — not deriving props into
      // state, just resetting for the "no spotlight" case.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null);
      return;
    }
    const r = measure(step.target);
    if (!r) {
      if (index < TOUR_STEPS.length - 1) {
        setIndex((i) => i + 1);
      } else {
        finish();
      }
      return;
    }
    setRect(r);
  }, [index, step, finish]);

  // Keep the cutout glued to its target across resize/scroll, and pick up
  // layout changes on the target itself (e.g. suggestions list opening).
  useEffect(() => {
    if (!step || step.target === null) return;
    const target = step.target;
    const el = document.querySelector(`[data-onboarding="${target}"]`);
    if (!el) return;

    function recompute() {
      const r = measure(target);
      if (r) setRect(r);
    }

    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [step]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (isLast) finish();
        else goNext();
      } else if (e.key === "ArrowLeft") goBack();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLast, finish, goNext, goBack]);

  if (!step) return null;

  const side = pickSide(rect ?? { top: 0, left: 0, width: 0, height: 0 });
  const effectiveSide: Side = rect ? side : "center";
  const transitionClass = reducedMotion ? "" : " transition-all duration-200 ease-out";

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" aria-hidden="false">
      {rect ? (
        <div
          aria-hidden="true"
          className={"fixed rounded-md" + transitionClass}
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: `0 0 0 9999px ${DIM_COLOR}`,
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0" style={{ backgroundColor: DIM_COLOR }} />
      )}

      {rect ? (
        <div
          aria-hidden="true"
          className={"fixed rounded-md border-2 border-platform" + transitionClass}
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : null}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${step.title} — step ${index + 1} of ${TOUR_STEPS.length}`}
        className={
          "pointer-events-auto fixed z-10 w-[min(300px,calc(100vw-24px))] border border-ground-line bg-ground-raised p-4 shadow-lg" +
          transitionClass
        }
        style={tooltipStyle(rect, effectiveSide)}
      >
        <p className="chrome text-[10px] text-platform-faint">{step.eyebrow}</p>
        <h2 className="mt-1 font-display text-xl leading-tight text-platform">{step.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-platform-dim">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="chrome text-[11px] text-platform-dim underline decoration-dotted underline-offset-4 hover:text-platform"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={index === 0}
              className="chrome px-3 py-2 text-[11px] text-platform-dim disabled:opacity-30"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => (isLast ? finish() : goNext())}
              className="chrome border border-platform bg-platform px-4 py-2 text-[11px] font-medium text-ground hover:brightness-110"
            >
              {isLast ? "Start spinning →" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
