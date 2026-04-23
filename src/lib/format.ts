/**
 * Convert "17:00" (24h) → "5:00 PM".
 * Handles null/undefined and "-" passthroughs.
 */
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "-";
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm; // fallback - show as-is if not HH:MM
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

/**
 * Convert "2026-04-04" → "Saturday, April 4, 2026".
 * We parse as local time (not UTC) so the weekday matches how the manager entered it.
 */
export function formatDate(ymd: string | null | undefined): string {
  if (!ymd) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1; // JS Date months are 0-indexed
  const day = Number(m[3]);
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
