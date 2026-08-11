/**
 * Whether the local visitor has already dismissed the onboarding overlay.
 * Same localStorage-guard pattern as `src/lib/local-user.ts` — this file
 * is client-only, and storage failures degrade silently (worst case: the
 * overlay reappears next visit, never a crash).
 */

const ONBOARDED_KEY = "derive:onboarded";

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function hasSeenOnboarding(): boolean {
  if (!hasLocalStorage()) return true; // no storage to persist a flag -> don't nag every render
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
}

export function markOnboardingSeen(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // private browsing / quota exceeded — the overlay just reappears next visit
  }
}
