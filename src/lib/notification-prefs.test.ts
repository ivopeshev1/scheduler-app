import { describe, it, expect } from "vitest";
import {
  userWantsNotification, resolvePreferences, prefsFromFormData,
  NOTIFICATION_CHANNELS,
} from "./notification-prefs";

describe("userWantsNotification", () => {
  it("defaults to true on both channels when nothing is stored", () => {
    expect(userWantsNotification(null, "shiftReminder", "email")).toBe(true);
    expect(userWantsNotification({}, "shiftReminder", "sms")).toBe(true);
    expect(userWantsNotification(undefined, "shiftReminder", "email")).toBe(true);
  });
  it("staff email is always on, regardless of what's stored", () => {
    // Staff channel - stored false should NOT turn off email.
    expect(userWantsNotification({ shiftReminder: { email: false, sms: false } }, "shiftReminder", "email")).toBe(true);
    expect(userWantsNotification({ shiftReminder: false }, "shiftReminder", "email")).toBe(true);
    // SMS still respects the stored value.
    expect(userWantsNotification({ shiftReminder: { email: false, sms: false } }, "shiftReminder", "sms")).toBe(false);
    expect(userWantsNotification({ shiftReminder: { email: true, sms: true } }, "shiftReminder", "sms")).toBe(true);
  });
  it("manager email respects per-channel stored values", () => {
    const stored = { dailyDigest: { email: false, sms: true } };
    expect(userWantsNotification(stored, "dailyDigest", "email")).toBe(false);
    expect(userWantsNotification(stored, "dailyDigest", "sms")).toBe(true);
  });
  it("falls back to default when only one channel is stored on a manager key", () => {
    const stored = { dailyDigest: { email: false } };
    expect(userWantsNotification(stored, "dailyDigest", "email")).toBe(false);
    expect(userWantsNotification(stored, "dailyDigest", "sms")).toBe(true);
  });
  it("respects legacy boolean values on manager keys", () => {
    const stored = { dailyDigest: false };
    expect(userWantsNotification(stored, "dailyDigest", "email")).toBe(false);
    expect(userWantsNotification(stored, "dailyDigest", "sms")).toBe(false);
  });
  it("ignores stored prefs on alwaysOn channels", () => {
    expect(userWantsNotification({ shiftInvite: { email: false, sms: false } }, "shiftInvite", "email")).toBe(true);
    expect(userWantsNotification({ accountChange: { email: false, sms: false } }, "accountChange", "sms")).toBe(true);
    expect(userWantsNotification({ staffCancellation: { email: false, sms: false } }, "staffCancellation", "email")).toBe(true);
  });
});

describe("resolvePreferences", () => {
  it("staff email is always on, even if stored false", () => {
    const r = resolvePreferences({ shiftReminder: { email: false, sms: false } });
    expect(r.shiftReminder).toEqual({ email: true, sms: false });
  });
  it("fills defaults for missing keys / channels (manager)", () => {
    const r = resolvePreferences({ dailyDigest: { email: false } });
    expect(r.dailyDigest).toEqual({ email: false, sms: true });
    expect(r.inviteResponse).toEqual({ email: true, sms: true });
  });
  it("forces alwaysOn keys to on", () => {
    const r = resolvePreferences({ shiftInvite: { email: false, sms: false } });
    expect(r.shiftInvite).toEqual({ email: true, sms: true });
  });
  it("works on null / undefined input", () => {
    const r = resolvePreferences(null);
    expect(r.shiftReminder).toEqual({ email: true, sms: true });
  });
  it("legacy boolean entries carry through on manager keys", () => {
    const r = resolvePreferences({ dailyDigest: false });
    expect(r.dailyDigest).toEqual({ email: false, sms: false });
  });
  it("legacy boolean entries can't drop staff email below the floor", () => {
    const r = resolvePreferences({ shiftReminder: false });
    expect(r.shiftReminder).toEqual({ email: true, sms: false });
  });
});

describe("prefsFromFormData", () => {
  it("staff email is forced true, SMS reads from the form", () => {
    const checked = new Set(["pref_shiftReminder_sms"]);
    const getter = (k: string): FormDataEntryValue | null => (checked.has(k) ? "on" : null);
    const result = prefsFromFormData(getter, "staff");
    expect(result.shiftReminder).toEqual({ email: true, sms: true });
    expect(result.beoSent).toEqual({ email: true, sms: false });
    expect("shiftInvite" in result).toBe(false); // alwaysOn omitted
    expect("inviteResponse" in result).toBe(false); // other audience
  });
  it("omits every alwaysOn + wrong-audience channel for manager", () => {
    const getter = (): FormDataEntryValue | null => null;
    const result = prefsFromFormData(getter, "manager");
    const expected = NOTIFICATION_CHANNELS.filter((c) => c.audience === "manager" && !c.alwaysOn).map((c) => c.key);
    for (const k of expected) {
      expect(result[k]).toEqual({ email: false, sms: false });
    }
    expect("staffCancellation" in result).toBe(false);
    expect("urgentOpenShifts" in result).toBe(false);
  });
});
