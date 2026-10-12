/**
 * Per-user UI preferences for the manager-side app. Stored as a JSON blob
 * on manager_profiles.ui_preferences so adding new keys doesn't need a
 * migration. mergeUiPreferences fills in defaults for any key the stored
 * blob is missing (e.g. a new preference landed in a release after the
 * user's row was created).
 */

export type DefaultLandingTab = "calendar-grid" | "calendar-list" | "payroll" | "staff";
export type CalendarDefaultView = "grid" | "list";
export type TimeFormat = "12h" | "24h";
export type DateFormat = "mdy" | "dmy" | "iso";

export type UiPreferences = {
  defaultLandingTab: DefaultLandingTab;
  calendarDefaultView: CalendarDefaultView;
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  defaultLandingTab: "calendar-grid",
  calendarDefaultView: "grid",
  timeFormat: "12h",
  dateFormat: "mdy",
};

export function mergeUiPreferences(stored: unknown): UiPreferences {
  if (!stored || typeof stored !== "object") return DEFAULT_UI_PREFERENCES;
  const s = stored as Partial<UiPreferences>;
  return { ...DEFAULT_UI_PREFERENCES, ...s };
}

/**
 * Map a defaultLandingTab preference to the URL that tab lives at. Used
 * when a manager hits /manager after login — we redirect to their
 * preferred starting view instead of always landing on the calendar.
 */
export function landingTabHref(pref: DefaultLandingTab): string {
  switch (pref) {
    case "calendar-grid": {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return `/manager/calendar/${ym}`;
    }
    case "calendar-list": {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return `/manager/month/${ym}`;
    }
    case "payroll":
      return "/manager/payroll";
    case "staff":
      return "/manager/staff";
  }
}
