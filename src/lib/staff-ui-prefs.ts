/**
 * Staff-side UI preferences. Smaller subset of the manager version -
 * no landing-tab or calendar-view defaults because the staff UX is
 * simpler (always lands on My shifts).
 */
import type { TimeFormat, DateFormat } from "./ui-prefs";

export type StaffUiPreferences = {
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
};

export const DEFAULT_STAFF_UI_PREFERENCES: StaffUiPreferences = {
  timeFormat: "12h",
  dateFormat: "mdy",
};

export function mergeStaffUiPreferences(stored: unknown): StaffUiPreferences {
  if (!stored || typeof stored !== "object") return DEFAULT_STAFF_UI_PREFERENCES;
  const s = stored as Partial<StaffUiPreferences>;
  return { ...DEFAULT_STAFF_UI_PREFERENCES, ...s };
}
