/**
 * Timezone-boundary-safe helpers for the daily lock.
 *
 * DERIVE is "one spin a day" keyed to the *user's own local midnight*, not
 * NYC's — the client sends its IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
 * with every spin request and it's stored on the card. Someone in Mumbai
 * typing a NYC ZIP still gets their own local day boundary; the place they're
 * dealt happens to be in NYC, but the calendar day it's "for" is theirs.
 *
 * We deliberately never do timestamp arithmetic (like `+24h` or manually
 * computing a UTC offset) to find "midnight" — offsets shift across DST
 * transitions and differ per calendar day. Instead we always ask
 * `Intl.DateTimeFormat` what the calendar date is *right now, in that tz*,
 * and compare calendar dates as strings. That sidesteps DST and the
 * international date line entirely: the ICU timezone database already
 * knows the wall-clock date for any IANA zone at any instant.
 */

function formatterFor(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** YYYY-MM-DD calendar date for `at` (defaults to now) in the given IANA timezone. */
export function localDateISO(timezone: string, at: Date = new Date()): string {
  const parts = formatterFor(timezone).formatToParts(at);
  const map: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  if (!map.year || !map.month || !map.day) {
    throw new Error(`Unable to compute local date for timezone "${timezone}"`);
  }
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * True once `at` (defaults to now) has crossed local midnight ending
 * `dealtDate` in `timezone` — i.e. the current local calendar date in that
 * timezone is later than `dealtDate`. Fixed-width YYYY-MM-DD strings compare
 * correctly with plain lexicographic `>`, so no Date arithmetic is needed.
 */
export function isExpired(dealtDate: string, timezone: string, at: Date = new Date()): boolean {
  return localDateISO(timezone, at) > dealtDate;
}
