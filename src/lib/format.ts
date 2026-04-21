/**
 * Convert "17:00" (24h) → "5:00 PM".
 * Handles null/undefined and "—" passthroughs.
 */
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "—";
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm; // fallback — show as-is if not HH:MM
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}
