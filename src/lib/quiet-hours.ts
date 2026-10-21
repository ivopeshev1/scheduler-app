/**
 * Quiet-hours predicate for SMS. The user picks a daily window in
 * their local timezone - e.g. 21:00 to 08:00 - during which the app
 * never sends them SMS. Email ignores this.
 *
 * The window is wrap-aware: if start > end (21:00 → 08:00), the window
 * spans midnight. Start == end is treated as disabled.
 */

export type QuietHours = {
  start: string | null; // HH:MM 24-hour, local to tz
  end: string | null;   // HH:MM 24-hour, local to tz
  tz: string | null;    // IANA tz name; falls back to America/Los_Angeles
};

const DEFAULT_TZ = "America/Los_Angeles";

/** Parse HH:MM to minutes-since-midnight, or null if malformed / missing. */
function toMin(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * Current clock-minute within the given timezone. Uses Intl.DateTimeFormat
 * so we don't ship a full tz library — tradeoff is a tiny parse, not a
 * perf hot path.
 */
export function nowMinutesInTz(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(now);
  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value);
    if (p.type === "minute") m = Number(p.value);
  }
  // Intl can return "24" for hour "24:00" - normalize to 0.
  if (h === 24) h = 0;
  return h * 60 + m;
}

/**
 * Is the current moment within the user's quiet-hours window?
 * Returns false when quiet hours aren't configured (either side null,
 * same start/end, or malformed inputs). The window is half-open:
 * [start, end) so a quiet range of 21:00–08:00 means SMS resumes at 8:00
 * sharp but is still blocked at 7:59.
 */
export function isInQuietHours(now: Date, qh: QuietHours): boolean {
  const start = toMin(qh.start);
  const end = toMin(qh.end);
  if (start == null || end == null) return false;
  if (start === end) return false;
  const tz = qh.tz || DEFAULT_TZ;
  let cur: number;
  try {
    cur = nowMinutesInTz(now, tz);
  } catch {
    cur = nowMinutesInTz(now, DEFAULT_TZ);
  }
  // Wrap-aware: if end < start, the window spans midnight.
  if (end < start) {
    return cur >= start || cur < end;
  }
  return cur >= start && cur < end;
}
