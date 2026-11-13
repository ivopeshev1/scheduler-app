/**
 * Per-position shift times.
 *
 * Every event has a check-in time and an end time. A position row can
 * optionally carry its own start/end (positions.startTime / endTime) for
 * staffing agencies that schedule roles at different times on the same
 * event. When a row has no custom times it uses the event's.
 *
 * Anything staff-facing that shows or uses "when is my shift" should go
 * through these helpers so a row's custom times win over the event's.
 */

type EventTimes = { checkInTime: string | null; endTime: string | null };
type PositionTimes = { startTime?: string | null; endTime?: string | null } | null | undefined;

/** The effective start/end for a shift on this position. */
export function shiftTimes(event: EventTimes, position: PositionTimes): { start: string | null; end: string | null; custom: boolean } {
  const ps = position?.startTime || null;
  const pe = position?.endTime || null;
  return {
    start: ps ?? event.checkInTime ?? null,
    end: pe ?? event.endTime ?? null,
    custom: !!(ps || pe),
  };
}

/**
 * Return a copy of the event with checkInTime/endTime swapped for the
 * position's custom times (when it has any). Lets existing code that reads
 * event.checkInTime / event.endTime pick up row times with a one-line change.
 */
export function withShiftTimes<E extends EventTimes>(event: E, position: PositionTimes): E {
  const t = shiftTimes(event, position);
  if (!t.custom) return event;
  return { ...event, checkInTime: t.start, endTime: t.end };
}
