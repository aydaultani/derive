/**
 * A card expires at local midnight ending `dealtDate`, in the card's own
 * timezone (per CONTRACT.md's daily-lock section) — always "11:59 PM" in
 * that timezone, computed for real rather than hardcoded so the copy stays
 * correct if the product ever needs the date alongside it.
 */
export function formatExpiryLabel(dealtDate: string, timezone: string): string {
  // Treat "YYYY-MM-DDT23:59:00" as if it were UTC, then shift by the
  // target timezone's offset at that instant — the standard trick for
  // resolving a wall-clock time in an arbitrary IANA zone without a date
  // library.
  const naiveUtc = new Date(`${dealtDate}T23:59:00Z`);
  const offsetMinutes = timeZoneOffsetMinutes(naiveUtc, timezone);
  const expiryInstant = new Date(naiveUtc.getTime() - offsetMinutes * 60_000);

  const formatted = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(expiryInstant);

  return `Expires ${formatted}`;
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return (asUtc - date.getTime()) / 60_000;
}
