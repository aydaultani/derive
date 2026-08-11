/**
 * DERIVE has no accounts. Identity is an opaque random id minted on first
 * visit and persisted in localStorage — the server never sees more than
 * this id. This file is client-only.
 *
 * The `cards` table (server-side) is the record of truth for collection /
 * completion history — the streak helpers below are a minimal, purely
 * local approximation used to drive the streak-dot chrome in the header
 * before/without a network round trip. Don't grow this into a data store.
 */

const USER_ID_KEY = "derive:userId";
const STREAK_DATES_KEY = "derive:streakDates";
const MAX_TRACKED_STREAK_DATES = 30;

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Get the local anonymous user id, minting and persisting one on first call. */
export function getOrCreateUserId(): string {
  if (!hasLocalStorage()) {
    // SSR / storage-denied environment — caller gets a throwaway id rather
    // than a crash. Real persistence only happens client-side.
    return crypto.randomUUID();
  }
  const existing = window.localStorage.getItem(USER_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(USER_ID_KEY, created);
  return created;
}

function readStreakDates(): string[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STREAK_DATES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

/** Record that the local user saw a dealt card for `dealtDate` (YYYY-MM-DD). */
export function recordCardSeen(dealtDate: string): void {
  if (!hasLocalStorage()) return;
  const dates = readStreakDates();
  if (dates.includes(dealtDate)) return;
  const next = [...dates, dealtDate].sort().slice(-MAX_TRACKED_STREAK_DATES);
  try {
    window.localStorage.setItem(STREAK_DATES_KEY, JSON.stringify(next));
  } catch {
    // storage full / disabled — streak chrome degrades silently
  }
}

/** Consecutive-day streak ending today (or the most recent seen day), in `timezone`. */
export function getCurrentStreak(timezone: string): number {
  const dates = new Set(readStreakDates());
  if (dates.size === 0) return 0;

  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  let streak = 0;
  const now = Date.now();
  for (let daysAgo = 0; daysAgo < MAX_TRACKED_STREAK_DATES; daysAgo++) {
    const dayStr = dayFormatter.format(new Date(now - daysAgo * 86_400_000));
    if (dates.has(dayStr)) {
      streak += 1;
    } else if (daysAgo > 0) {
      break;
    }
  }
  return streak;
}
