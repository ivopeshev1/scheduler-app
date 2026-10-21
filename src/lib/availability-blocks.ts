/**
 * Partial-day availability block helpers. A block is either whole-day
 * (both startTime + endTime null) or a time range [start, end). The
 * staff-side form on /staff/calendar lets a staffer create either kind;
 * the manager-side picker uses blocksCoverShift() to decide whether
 * to mark them unavailable for a specific event's working window.
 */

export type AvailabilityBlock = {
  startTime: string | null; // HH:MM 24-hr
  endTime: string | null;   // HH:MM 24-hr
};

export type ShiftWindow = {
  checkInTime: string | null; // HH:MM 24-hr; null = no explicit start
  endTime: string | null;     // HH:MM 24-hr; null = no explicit end
};

/** Convert HH:MM to minutes-since-midnight. Null-safe (returns null). */
function toMin(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  return h * 60 + mm;
}

/**
 * Does any of the blocks on this date make the given shift window unavailable?
 *
 * Rules:
 *  - Whole-day block (both times null) → always blocks.
 *  - Partial block without a known shift window → blocks (conservative: if
 *    the staffer didn't specify but a block exists, assume overlap).
 *  - Partial block + known shift window → blocks only when the ranges
 *    overlap. Half-open on the end: a block that ends exactly at the
 *    shift's start doesn't overlap.
 */
export function blocksCoverShift(blocks: AvailabilityBlock[], shift: ShiftWindow): boolean {
  if (blocks.length === 0) return false;
  const shiftStart = toMin(shift.checkInTime);
  const shiftEnd = toMin(shift.endTime);
  for (const b of blocks) {
    const bStart = toMin(b.startTime);
    const bEnd = toMin(b.endTime);
    const wholeDay = bStart == null && bEnd == null;
    if (wholeDay) return true;
    if (shiftStart == null || shiftEnd == null) return true;
    const bs = bStart ?? 0;
    const be = bEnd ?? 24 * 60;
    // Half-open overlap: ranges intersect iff bs < shiftEnd && shiftStart < be
    if (bs < shiftEnd && shiftStart < be) return true;
  }
  return false;
}

/** Short human label for the block ("Whole day" or "6:00 PM – 11:00 PM"). */
export function describeBlock(b: AvailabilityBlock, format12 = true): string {
  if (!b.startTime && !b.endTime) return "Whole day";
  const s = formatHHMM(b.startTime, format12);
  const e = formatHHMM(b.endTime, format12);
  if (b.startTime && b.endTime) return `${s} – ${e}`;
  if (b.startTime) return `From ${s}`;
  return `Until ${e}`;
}

function formatHHMM(hhmm: string | null, format12: boolean): string {
  if (!hhmm) return "";
  const m = toMin(hhmm);
  if (m == null) return hhmm;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (!format12) return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}
