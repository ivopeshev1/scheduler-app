import { describe, it, expect } from "vitest";
import {
  userWantsNotification, resolvePreferences, prefsFromFormData,
  DEFAULT_PREFS, NOTIFICATION_CHANNELS,
} from "./notification-prefs";

describe("userWantsNotification", () => {
  it("defaults to true when nothing is stored", () => {
    expect(userWantsNotification(null, "shiftInvite")).toBe(true);
    expect(userWantsNotification({}, "shiftInvite")).toBe(true);
    expect(userWantsNotification(undefined, "shiftInvite")).toBe(true);
  });
  it("respects a stored false", () => {
    expect(userWantsNotification({ shiftInvite: false }, "shiftInvite")).toBe(false);
  });
  it("respects a stored true", () => {
    expect(userWantsNotification({ shiftInvite: true }, "shiftInvite")).toBe(true);
  });
  it("ignores non-boolean values", () => {
    expect(userWantsNotification({ shiftInvite: "nope" }, "shiftInvite")).toBe(true);
    expect(userWantsNotification({ shiftInvite: 0 }, "shiftInvite")).toBe(true);
  });
  it("alwaysOn keys ignore stored prefs", () => {
    expect(userWantsNotification({ accountChange: false }, "accountChange")).toBe(true);
    expect(userWantsNotification({ passwordReset: false }, "passwordReset")).toBe(true);
  });
});

describe("resolvePreferences", () => {
  it("fills in defaults for missing keys", () => {
    const resolved = resolvePreferences({ shiftInvite: false });
    expect(resolved.shiftInvite).toBe(false);
    expect(resolved.beoSent).toBe(true);
  });
  it("forces alwaysOn keys to true even if stored false", () => {
    const resolved = resolvePreferences({ accountChange: false });
    expect(resolved.accountChange).toBe(true);
  });
  it("works on null / undefined input", () => {
    expect(resolvePreferences(null)).toEqual(DEFAULT_PREFS);
    expect(resolvePreferences(undefined)).toEqual(DEFAULT_PREFS);
  });
});

describe("prefsFromFormData", () => {
  it("captures only staff-audience, non-alwaysOn checkboxes for staff", () => {
    const checked = new Set(["pref_shiftInvite", "pref_shiftReminder"]);
    const getter = (k: string): FormDataEntryValue | null => (checked.has(k) ? "on" : null);
    const result = prefsFromFormData(getter, "staff");
    expect(result.shiftInvite).toBe(true);
    expect(result.shiftReminder).toBe(true);
    expect(result.beoSent).toBe(false); // not checked → unchecked
    expect("accountChange" in result).toBe(false); // alwaysOn → not included
    expect("inviteResponse" in result).toBe(false); // manager-audience, not included
  });
  it("captures only manager-audience, non-alwaysOn checkboxes for manager", () => {
    const getter = (): FormDataEntryValue | null => null;
    const result = prefsFromFormData(getter, "manager");
    const managerKeys = NOTIFICATION_CHANNELS.filter((c) => c.audience === "manager" && !c.alwaysOn).map((c) => c.key);
    for (const k of managerKeys) expect(result[k]).toBe(false);
    expect("shiftInvite" in result).toBe(false);
  });
});
