/**
 * Event-setup field registry. Preset field keys map to hardcoded columns on
 * the events table; custom fields (isCustom=true in the db) store values in
 * event_custom_values.
 *
 * Each preset field declares:
 *   - bucket: "required" (always on, locked in settings) vs "optional"
 *       (can be toggled off) vs "suggested" (off by default but recommended)
 *   - inputType: what kind of <input> to render on the event setup page
 *   - required: default required-ness if the company hasn't saved config yet
 *
 * Settings → Event fields renders these in bucket order. The event new/edit
 * pages walk the enabled configs and render one input per entry.
 */

export type FieldBucket = "required" | "additional";
export type FieldInputType = "text" | "textarea" | "date" | "time" | "number" | "tel" | "email" | "attachments";

export type PresetFieldDef = {
  key: string;
  label: string;
  bucket: FieldBucket;
  inputType: FieldInputType;
  // If bucket === "required" the owner can't disable or make it non-required.
  lockedEnabled?: boolean;
  lockedRequired?: boolean;
  // Help copy shown under the field on the event setup page (optional).
  help?: string;
};

export const PRESET_FIELDS: PresetFieldDef[] = [
  { key: "date",              label: "Date",                 bucket: "required", inputType: "date", lockedEnabled: true, lockedRequired: true },
  { key: "cityAddress",       label: "Address / City",       bucket: "required", inputType: "text", lockedEnabled: true, lockedRequired: true },
  { key: "checkInTime",       label: "Staff check-in time",  bucket: "required", inputType: "time", lockedEnabled: true, lockedRequired: true, help: "When staff should arrive on site." },
  { key: "eventStartTime",    label: "Event start time",     bucket: "required", inputType: "time", lockedEnabled: true, lockedRequired: true, help: "When guests arrive / service begins." },
  { key: "endTime",           label: "Event end time",       bucket: "required", inputType: "time", lockedEnabled: true, lockedRequired: true },
  { key: "eventType",         label: "Event type",           bucket: "required", inputType: "text", lockedEnabled: true, lockedRequired: true },
  { key: "clientName",        label: "Client name",          bucket: "required", inputType: "text", lockedEnabled: true, lockedRequired: true },
  { key: "attachments",       label: "Attachments (BEO, manuals, etc.)", bucket: "required", inputType: "attachments", lockedEnabled: true, help: "PDF, images, xlsx, docs. Shared files go in the invite email." },
  { key: "venue",             label: "Venue",                bucket: "additional", inputType: "text" },
  { key: "clientContactInfo", label: "Client contact info",  bucket: "additional", inputType: "text" },
  { key: "plannerName",       label: "Planner name",         bucket: "additional", inputType: "text" },
  { key: "plannerContactInfo",label: "Planner contact info", bucket: "additional", inputType: "text" },
  { key: "guestCount",        label: "Number of guests",     bucket: "additional", inputType: "number" },
  { key: "numBars",           label: "Number of bars",       bucket: "additional", inputType: "number" },
];

export const PRESET_BY_KEY: Record<string, PresetFieldDef> = Object.fromEntries(
  PRESET_FIELDS.map((f) => [f.key, f])
);

export function isPresetKey(key: string): boolean {
  return key in PRESET_BY_KEY;
}

/**
 * Which events-table column a preset key writes to. Used by the event save
 * actions to map form inputs back onto the events row.
 */
export const PRESET_KEY_TO_COLUMN: Record<string, keyof PresetEventColumns> = {
  date: "date",
  cityAddress: "city",
  checkInTime: "checkInTime",
  eventStartTime: "eventStartTime",
  endTime: "endTime",
  eventType: "eventType",
  clientName: "clientName",
  clientContactInfo: "clientContactInfo",
  venue: "venue",
  plannerName: "planner",
  plannerContactInfo: "plannerContactInfo",
  guestCount: "guestCount",
  numBars: "numBars",
};

export type PresetEventColumns = {
  date: string;
  city: string | null;
  checkInTime: string | null;
  eventStartTime: string | null;
  endTime: string | null;
  eventType: string | null;
  clientName: string;
  clientContactInfo: string | null;
  venue: string | null;
  planner: string | null;
  plannerContactInfo: string | null;
  guestCount: number | null;
  numBars: number | null;
};
