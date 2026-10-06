/**
 * Pay-period math shared by Settings + the Payroll tab.
 *
 * A pay period is defined by two company-level settings:
 *   - cadence: "weekly" | "biweekly" | "monthly"
 *   - anchor: YYYY-MM-DD date that any pay period in the past, present,
 *     or future starts on (for weekly/biweekly), or the start day for
 *     monthly periods ("2026-01-01" means periods run month-to-month).
 *
 * Given a reference date, computePayPeriod returns the {start, end}
 * (inclusive, YYYY-MM-DD) of the period containing that date. move
 * jumps forward/backward by one period.
 */

export type Cadence = "weekly" | "biweekly" | "monthly";

export type PayPeriod = {
  start: string; // YYYY-MM-DD inclusive
  end: string;   // YYYY-MM-DD inclusive
  cadence: Cadence;
};

/** Zero-pad to 2 digits for YYYY-MM-DD. */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Parse YYYY-MM-DD into a UTC Date at midnight. Safer than new Date(str). */
function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

/**
 * Compute the pay period containing `on` given the company's cadence
 * and anchor. Falls back to a sensible default (Mon-Sun of the current
 * week) if anchor isn't configured yet.
 */
export function computePayPeriod(
  on: string,
  cadence: Cadence,
  anchor: string | null,
): PayPeriod {
  const onDate = parseDate(on);

  if (cadence === "monthly") {
    const y = onDate.getUTCFullYear();
    const m = onDate.getUTCMonth();
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 0));
    return { start: fmtDate(start), end: fmtDate(end), cadence };
  }

  // Weekly / biweekly. Need an anchor so periods line up with the
  // company's actual pay schedule. Fall back to the Monday of the
  // week of `on` so we show something useful before the manager has
  // picked an anchor.
  const periodLength = cadence === "biweekly" ? 14 : 7;
  if (!anchor) {
    const dow = onDate.getUTCDay(); // 0=Sun..6=Sat
    const mondayOffset = (dow + 6) % 7; // days since Monday
    const start = addDays(onDate, -mondayOffset);
    const end = addDays(start, periodLength - 1);
    return { start: fmtDate(start), end: fmtDate(end), cadence };
  }

  const anchorDate = parseDate(anchor);
  const dayDiff = Math.floor((onDate.getTime() - anchorDate.getTime()) / (24 * 60 * 60 * 1000));
  // Floor-mod so negative diffs still land on a correct boundary.
  const periodsBack = Math.floor(dayDiff / periodLength);
  const start = addDays(anchorDate, periodsBack * periodLength);
  const end = addDays(start, periodLength - 1);
  return { start: fmtDate(start), end: fmtDate(end), cadence };
}

/** Jump to the previous or next pay period relative to `period`. */
export function movePayPeriod(
  period: PayPeriod,
  direction: 1 | -1,
  anchor: string | null,
): PayPeriod {
  if (period.cadence === "monthly") {
    const startDate = parseDate(period.start);
    const y = startDate.getUTCFullYear();
    const m = startDate.getUTCMonth();
    const next = new Date(Date.UTC(y, m + direction, 1));
    return computePayPeriod(fmtDate(next), period.cadence, anchor);
  }
  const periodLength = period.cadence === "biweekly" ? 14 : 7;
  const startDate = parseDate(period.start);
  const nextStart = addDays(startDate, periodLength * direction);
  return computePayPeriod(fmtDate(nextStart), period.cadence, anchor);
}

/**
 * Compute total hours worked (as a decimal) from clock-in / clock-out /
 * break stamps. Returns 0 when inputs are incomplete. Treats clock_out
 * < clock_in as crossing midnight (adds 24h).
 */
export function computeTotalHours(
  clockIn: string | null,
  clockOut: string | null,
  breakFrom: string | null,
  breakTo: string | null,
): number {
  function toMinutes(hm: string | null): number | null {
    if (!hm) return null;
    const [h, m] = hm.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }
  const inMin = toMinutes(clockIn);
  const outMin = toMinutes(clockOut);
  if (inMin == null || outMin == null) return 0;
  let shift = outMin - inMin;
  if (shift < 0) shift += 24 * 60; // crossed midnight
  const breakStart = toMinutes(breakFrom);
  const breakEnd = toMinutes(breakTo);
  if (breakStart != null && breakEnd != null) {
    let breakLen = breakEnd - breakStart;
    if (breakLen < 0) breakLen += 24 * 60;
    shift -= breakLen;
  }
  return Math.max(0, shift / 60);
}
