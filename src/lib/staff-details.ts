/**
 * What staff see about a shift in emails.
 *
 * Settings → Event fields has four switches per field:
 *   - enabled          → shows on the New / Edit Event form
 *   - required         → the form can't be saved without it
 *   - shareWithStaff   → included in the shift details staff get by email
 *                        (and on their shift page)
 *   - notifyOnChange   → editing it sends invited staff a "shift updated" email
 *
 * This module turns those settings into the rows of the details table used
 * by invite and change emails, so every email follows the same rules.
 *
 * Date, check-in time and close time are always included: an invite without
 * them is useless. Close time shows "n/a" when it's blank.
 */
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { formatDate, formatTime } from "@/lib/format";
import { shiftTimes } from "@/lib/shift-times";

type EventRow = typeof schema.events.$inferSelect;
type PositionRow = typeof schema.positions.$inferSelect;
export type FieldConfig = typeof schema.eventFieldConfigs.$inferSelect;
export type DetailRow = [label: string, value: string];

/** Shown under the shift details in invite emails. */
export const TIME_MAY_CHANGE_NOTE = "Time may change.";

// Keys rendered separately (always-on rows) or not as a text row at all.
const NOT_A_TEXT_ROW = new Set(["date", "checkInTime", "endTime", "attachments"]);

export async function loadFieldConfigs(companyId: string): Promise<FieldConfig[]> {
  const rows = await db
    .select()
    .from(schema.eventFieldConfigs)
    .where(eq(schema.eventFieldConfigs.companyId, companyId));
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function loadCustomValues(eventId: string): Promise<Map<string, string | null>> {
  const rows = await db
    .select()
    .from(schema.eventCustomValues)
    .where(eq(schema.eventCustomValues.eventId, eventId));
  return new Map(rows.map((r) => [r.fieldKey, r.value]));
}

/** Display value of one field on an event ("" when empty). */
export function fieldValue(
  event: EventRow,
  key: string,
  isCustom: boolean,
  customValues: Map<string, string | null>,
): string {
  if (isCustom) return (customValues.get(key) ?? "").trim();
  switch (key) {
    case "date": return event.date ? formatDate(event.date) : "";
    case "cityAddress": return event.city ?? "";
    case "checkInTime": return event.checkInTime ? formatTime(event.checkInTime) : "";
    case "eventStartTime": return event.eventStartTime ? formatTime(event.eventStartTime) : "";
    case "endTime": return event.endTime ? formatTime(event.endTime) : "";
    case "eventType": return event.eventType ?? "";
    case "clientName": return event.clientName ?? "";
    case "clientContactInfo": return event.clientContactInfo ?? "";
    case "venue": return event.venue ?? "";
    case "plannerName": return event.planner ?? "";
    case "plannerContactInfo": return event.plannerContactInfo ?? "";
    case "guestCount": return event.guestCount != null ? String(event.guestCount) : "";
    case "numBars": return event.numBars != null ? String(event.numBars) : "";
    default: return "";
  }
}

/** Check-in time + close time rows for a shift (row custom times win). */
export function timeRows(event: EventRow, position: Pick<PositionRow, "startTime" | "endTime"> | null): DetailRow[] {
  const t = shiftTimes(event, position);
  return [
    ["Check-in time", t.start ? formatTime(t.start) : "n/a"],
    ["Close time", t.end ? formatTime(t.end) : "n/a"],
  ];
}

/**
 * Full details table for a staffer on this position: role, date, check-in,
 * close, then every field the company shares with staff (in Settings order),
 * custom fields included. Empty fields are skipped.
 */
export async function sharedDetailRows(
  event: EventRow,
  position: PositionRow,
  companyId: string,
  preloaded?: { configs?: FieldConfig[]; customValues?: Map<string, string | null> },
): Promise<DetailRow[]> {
  const configs = preloaded?.configs ?? (await loadFieldConfigs(companyId));
  const customValues = preloaded?.customValues ?? (await loadCustomValues(event.id));
  const rows: DetailRow[] = [
    ["Role", position.role],
    ["Date", formatDate(event.date)],
    ...timeRows(event, position),
  ];
  for (const c of configs) {
    if (!c.enabled || !c.shareWithStaff) continue;
    if (!c.isCustom && NOT_A_TEXT_ROW.has(c.fieldKey)) continue;
    const v = fieldValue(event, c.fieldKey, c.isCustom, customValues);
    if (!v) continue;
    rows.push([c.label, v]);
  }
  return rows;
}
