/**
 * Pure dispatch logic for the hourly shift-reminders cron. Separated from
 * the route handler so every edge is testable - timezone math, "already
 * sent" guards, hour-of-day matching, and the day-before vs morning-of
 * difference.
 *
 * The route calls shouldSendReminderNow() for every live invitation
 * each hour; a true result triggers the email and the sent-at stamp.
 */

export type ReminderKind = "dayBefore" | "morningOf";

export type ReminderCheckInput = {
  kind: ReminderKind;
  /** The shift's calendar date, YYYY-MM-DD. */
  shiftDate: string;
  /** HH:MM 24h — the shift's own check-in time. Not required for the
   *  decision, but used by the caller for the email body. */
  shiftCheckInTime?: string | null;
  /** 0-23, the hour the staffer chose for this reminder kind, in their
   *  own local timezone. null = the staffer turned this reminder off. */
  chosenHour: number | null;
  /** IANA tz name, e.g. "America/Los_Angeles". Falls back to LA if null. */
  staffTz: string | null;
  /** True if we already sent this exact reminder for this invite. */
  alreadySent: boolean;
  /** Current moment. */
  now: Date;
};

const DEFAULT_TZ = "America/Los_Angeles";

/** Return the staffer's local (year, month, day, hour) at `now`. */
export function nowLocal(now: Date, tz: string): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    timeZone: tz,
  }).formatToParts(now);
  let y = 0, m = 0, d = 0, h = 0;
  for (const p of parts) {
    if (p.type === "year") y = Number(p.value);
    if (p.type === "month") m = Number(p.value);
    if (p.type === "day") d = Number(p.value);
    if (p.type === "hour") h = Number(p.value);
  }
  if (h === 24) h = 0; // Intl in some locales
  return { year: y, month: m, day: d, hour: h };
}

/** YYYY-MM-DD at a given tz for the local calendar date of `now`. */
export function localDateString(now: Date, tz: string): string {
  const { year, month, day } = nowLocal(now, tz);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Add N days to a YYYY-MM-DD string. Handles month/year rollover. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Decide whether a specific reminder should fire for this invite right now.
 *
 * Rules:
 *  - If the staffer turned this reminder off (chosenHour=null), never fire.
 *  - If we already sent this exact reminder (alreadySent), never fire.
 *  - "dayBefore" fires when the staffer's current LOCAL day is the day
 *    before the shift date, at their chosen hour (we're generous: the
 *    cron runs hourly, so we count a 1-hour match window - once the hour
 *    rolls past we miss it and the sent stamp is left null, which is
 *    fine for day-before noise but matters for morning-of).
 *  - "morningOf" fires when the staffer's current LOCAL day is the shift
 *    date and the hour has reached their chosen hour. We fire late if we
 *    missed the exact tick (e.g. a cron delay) - better to text them at
 *    8am than skip entirely if the window opened at 7am.
 */
export function shouldSendReminderNow(input: ReminderCheckInput): boolean {
  if (input.alreadySent) return false;
  if (input.chosenHour == null) return false;
  if (input.chosenHour < 0 || input.chosenHour > 23) return false;
  const tz = input.staffTz || DEFAULT_TZ;
  let local: { year: number; month: number; day: number; hour: number };
  try {
    local = nowLocal(input.now, tz);
  } catch {
    local = nowLocal(input.now, DEFAULT_TZ);
  }
  const today = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;

  if (input.kind === "dayBefore") {
    // Target local day = shiftDate - 1.
    const targetDay = addDays(input.shiftDate, -1);
    if (today !== targetDay) return false;
    // One-hour window match (exact hour the staffer chose).
    return local.hour === input.chosenHour;
  }

  // morningOf: target local day = shiftDate. Fire late if needed, but
  // never earlier than the chosen hour.
  if (today !== input.shiftDate) return false;
  return local.hour >= input.chosenHour;
}
