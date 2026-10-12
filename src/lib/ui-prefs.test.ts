import { describe, it, expect } from "vitest";
import { mergeUiPreferences, landingTabHref, DEFAULT_UI_PREFERENCES } from "./ui-prefs";

describe("mergeUiPreferences", () => {
  it("returns defaults for null / undefined / non-object", () => {
    expect(mergeUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(mergeUiPreferences(undefined)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(mergeUiPreferences("junk")).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("overlays stored values on top of defaults", () => {
    expect(mergeUiPreferences({ timeFormat: "24h" })).toEqual({
      ...DEFAULT_UI_PREFERENCES,
      timeFormat: "24h",
    });
  });

  it("fills in missing keys so new fields come through on old rows", () => {
    const partial = { timeFormat: "24h" as const };
    const merged = mergeUiPreferences(partial);
    expect(merged.defaultLandingTab).toBe(DEFAULT_UI_PREFERENCES.defaultLandingTab);
    expect(merged.calendarDefaultView).toBe(DEFAULT_UI_PREFERENCES.calendarDefaultView);
    expect(merged.dateFormat).toBe(DEFAULT_UI_PREFERENCES.dateFormat);
  });
});

describe("landingTabHref", () => {
  it("routes payroll + staff to their fixed urls", () => {
    expect(landingTabHref("payroll")).toBe("/manager/payroll");
    expect(landingTabHref("staff")).toBe("/manager/staff");
  });

  it("builds a calendar grid url for the current month", () => {
    const href = landingTabHref("calendar-grid");
    expect(href).toMatch(/^\/manager\/calendar\/\d{4}-\d{2}$/);
  });

  it("builds a calendar list url for the current month", () => {
    const href = landingTabHref("calendar-list");
    expect(href).toMatch(/^\/manager\/month\/\d{4}-\d{2}$/);
  });
});
