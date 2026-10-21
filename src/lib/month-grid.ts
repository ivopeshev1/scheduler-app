/**
 * Pure helpers for the staff calendar. The staff month view is a 6-row
 * Sunday-first grid padded with the leading / trailing days of the
 * neighboring months, so every month renders with the same height.
 *
 * All date math is on YYYY-MM-DD strings (what the DB stores) so there's
 * no accidental timezone shift between the server render and the
 * stored event / block dates.
 */

export function parseMonthSlug(slug: string | undefined, today: Date = new Date()): { year: number; month: number } {
  // Accept "YYYY-MM"; anything else falls back to today's month in UTC.
  const m = slug && /^(\d{4})-(\d{2})$/.exec(slug);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return { year: y, month: mo };
  }
  return { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
}

export function monthSlug(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Add a signed number of months, carrying over the year as needed. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0=Sun ... 6=Sat for the first of (year, month). */
export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export type GridDay = {
  iso: string; // YYYY-MM-DD
  day: number; // day of month (1..31)
  inMonth: boolean;
};

/**
 * Return a 42-cell (6 weeks) grid of GridDays for a month, Sunday-first,
 * padded with leading / trailing days from the neighboring months. Keeps
 * every rendered month the same height.
 */
export function buildMonthGrid(year: number, month: number): GridDay[] {
  const first = firstWeekdayOfMonth(year, month);
  const dim = daysInMonth(year, month);
  const prev = shiftMonth(year, month, -1);
  const prevDim = daysInMonth(prev.year, prev.month);
  const next = shiftMonth(year, month, 1);
  const cells: GridDay[] = [];
  // Leading cells from previous month.
  for (let i = first - 1; i >= 0; i--) {
    const d = prevDim - i;
    cells.push({ iso: `${prev.year}-${pad(prev.month)}-${pad(d)}`, day: d, inMonth: false });
  }
  // In-month cells.
  for (let d = 1; d <= dim; d++) {
    cells.push({ iso: `${year}-${pad(month)}-${pad(d)}`, day: d, inMonth: true });
  }
  // Trailing cells from next month until we hit 42.
  let d = 1;
  while (cells.length < 42) {
    cells.push({ iso: `${next.year}-${pad(next.month)}-${pad(d)}`, day: d, inMonth: false });
    d++;
  }
  return cells;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Pretty "October 2026" style label for the month header. */
export function monthLabel(year: number, month: number): string {
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${names[month - 1]} ${year}`;
}
