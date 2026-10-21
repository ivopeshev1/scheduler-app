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
  it("respects per-channel stored values", () => {
    const stored = { shiftReminder: { email: false, sms: true } };
    expect(userWantsNotification(stored, "shiftReminder", "email")).toBe(false);
    expect(userWantsNotification(stored, "shiftReminder", "sms")).toBe(true);
  });
  it("falls back to default when only one channel is stored", () => {
    const stored = { shiftReminder: { email: false } };
    expect(userWantsNotification(stored, "shiftReminder", "email")).toBe(false);
    expect(userWantsNotification(stored, "shiftReminder", "sms")).toBe(true);
  });
  it("respects legacy boolean values", () => {
    const stored = { shiftReminder: false };
    expect(userWantsNotification(stored, "shiftReminder", "email")).toBe(false);
    expect(userWantsNotification(stored, "shiftReminder", "sms")).toBe(false);
  });
  it("ignores stored prefs on alwaysOn channels", () => {
    expect(userWantsNotification({ shiftInvite: { email: false, sms: false } }, "shiftInvite", "email")).toBe(true);
    expect(userWantsNotification({ accountChange: { email: false, sms: false } }, "accountChange", "sms")).toBe(true);
    expect(userWantsNotification({ staffCancellation: { email: false, sms: false } }, "staffCancellation", "email")).toBe(true);
  });
});

describe("resolvePreferences", () => {
  it("fills defaults for missing keys / channels", () => {
    const r = resolvePreferences({ shiftReminder: { email: false } });
    expect(r.shiftReminder).toEqual({ email: false, sms: true });
    expect(r.beoSent).toEqual({ email: true, sms: true });
  });
  it("forces alwaysOn keys to on", () => {
    const r = resolvePreferences({ shiftInvite: { email: false, sms: false } });
    expect(r.shiftInvite).toEqual({ email: true, sms: true });
  });
  it("works on null / undefined input", () => {
    const r = resolvePreferences(null);
    expect(r.shiftReminder).toEqual({ email: true, sms: true });
  });
  it("handles legacy boolean entries", () => {
    const r = resolvePreferences({ shiftReminder: false });
    expect(r.shiftReminder).toEqual({ email: false, sms: false });
  });
});

describe("prefsFromFormData", () => {
  it("reads both channels for each toggleable staff channel", () => {
    const checked = new Set(["pref_shiftReminder_email"]);
    const getter = (k: string): FormDataEntryValue | null => (checked.has(k) ? "on" : null);
    const result = prefsFromFormData(getter, "staff");
    expect(result.shiftReminder).toEqual({ email: true, sms: false });
    expect(result.beoSent).toEqual({ email: false, sms: false });
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
