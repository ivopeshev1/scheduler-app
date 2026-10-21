/**
 * Minimal RFC-5545 ICS builder. Enough to drop one event into Apple
 * Calendar, Google Calendar, and Outlook. Floating times (no TZID) so
 * the user's calendar renders the shift at the local wall-clock time
 * they expect regardless of the device's timezone - safer than guessing
 * a tz the event wasn't stored with.
 */

export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM 24-hour; required */
  startTime: string;
  /** HH:MM 24-hour; required */
  endTime: string;
};

export function buildIcs(evt: IcsEvent): string {
  const dtStart = toIcsLocal(evt.date, evt.startTime);
  const dtEnd = toIcsLocal(evt.date, evt.endTime);
  const dtStamp = toIcsUtcNow();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escape(evt.uid)}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escape(evt.summary)}`,
    evt.location ? `LOCATION:${escape(evt.location)}` : null,
    evt.description ? `DESCRIPTION:${escape(evt.description)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].filter(Boolean) as string[];
  // ICS requires CRLF line endings for best interop.
  return lines.join("\r\n");
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function toIcsLocal(date: string, hhmm: string): string {
  // "2026-10-20" + "17:00" → "20261020T170000"
  const d = date.replace(/-/g, "");
  const t = hhmm.replace(":", "") + "00";
  return `${d}T${t}`;
}

function toIcsUtcNow(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  return (
    `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}T` +
    `${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`
  );
}
