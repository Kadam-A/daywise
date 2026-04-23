/**
 * Timezone utilities
 *
 * Always use the IANA timezone name (e.g. "America/New_York") for storage.
 * IANA + Intl.DateTimeFormat is DST-aware; a numeric offset is not.
 */

/** Returns the device's IANA timezone name, e.g. "America/New_York" */
export function getIANATimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Returns the current UTC offset in hours (e.g. -5, +5.5). Kept as fallback. */
export function getUTCOffsetHours(): number {
  return -new Date().getTimezoneOffset() / 60;
}

/**
 * Converts a UTC Date to local minutes-from-midnight using an IANA timezone.
 * Falls back to numeric offset if IANA name is unavailable.
 *
 * Examples: "America/New_York" gives correct EST/EDT depending on DST.
 *           "Asia/Kolkata" gives +5:30 year-round (no DST).
 */
export function utcToLocalMinutes(utcDate: Date, tzName: string | null, tzOffsetHours: number | null): number {
  if (tzName) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tzName,
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(utcDate);
      const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
      const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
      // Intl hour12:false can return 24 for midnight; normalise to 0
      return (h === 24 ? 0 : h) * 60 + m;
    } catch {
      // Fall through to numeric offset
    }
  }

  // Fallback: numeric offset (not DST-aware)
  const offset = tzOffsetHours ?? 0;
  const utcMinutes = utcDate.getUTCHours() * 60 + utcDate.getUTCMinutes();
  return ((utcMinutes + offset * 60) % (24 * 60) + 24 * 60) % (24 * 60);
}
