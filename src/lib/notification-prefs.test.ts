import { describe, it, expect } from "vitest";
import {
  userWantsNotification, resolvePreferences, prefsFromFormData,
  NOTIFICATION_CHANNELS,
} from "./notification-prefs";

describe("userWantsNotification", () => {
  it("defaults: email on everywhere, SMS off everywhere", () => {
    expect(userWantsNotification(null, "shiftReminder", "email")).toBe(true);
    expect(userWantsNotification(null, "shiftReminder", "sms")).toBe(false);
    expect(userWantsNotification(null, "shiftInvite", "email")).toBe(true);
    expect(userWantsNotification(null, "shiftInvite", "sms")).toBe(false);
    expect(userWantsNotification(null, "passwordReset", "sms")).toBe(false);
    expect(userWantsNotification(null, "accountChange", "sms")).toBe(false);
    expect(userWantsNotification(null, "beoSent", "sms")).toBe(false);
  });
  it("alwaysOn forces email on, but SMS stays user-choice", () => {
    expect(userWantsNotification({ shiftInvite: { email: false, sms: true } }, "shiftInvite", "email")).toBe(true);
    expect(userWantsNotification({ shiftInvite: { email: false, sms: true } }, "shiftInvite", "sms")).toBe(true);
    expect(userWantsNotification({ shiftInvite: { email: false, sms: false } }, "shiftInvite", "sms")).toBe(false);
  });
  it("staff email always on, SMS stays user-choice", () => {
    expect(userWantsNotification({ shiftReminder: { email: false, sms: false } }, "shiftReminder", "email")).toBe(true);
    expect(userWantsNotification({ shiftReminder: { email: false, sms: true } }, "shiftReminder", "sms")).toBe(true);
    expect(userWantsNotification({ shiftReminder: false }, "shiftReminder", "sms")).toBe(false);
  });
  it("manager email is also always on, SMS still per-channel", () => {
    const stored = { dailyDigest: { email: false, sms: true } };
    expect(userWantsNotification(stored, "dailyDigest", "email")).toBe(true);
    expect(userWantsNotification(stored, "dailyDigest", "sms")).toBe(true);
  });
  it("legacy boolean false can't drop email below the floor on manager keys", () => {
    expect(userWantsNotification({ dailyDigest: false }, "dailyDigest", "email")).toBe(true);
    expect(userWantsNotification({ dailyDigest: false }, "dailyDigest", "sms")).toBe(false);
  });
});

describe("resolvePreferences", () => {
  it("staff email always on", () => {
    const r = resolvePreferences({ shiftReminder: { email: false, sms: false } });
    expect(r.shiftReminder).toEqual({ email: true, sms: false });
  });
  it("required (alwaysOn) email on + SMS user-choice", () => {
    const r = resolvePreferences({});
    expect(r.shiftInvite).toEqual({ email: true, sms: false }); // default off
    expect(r.passwordReset).toEqual({ email: true, sms: false });
    const r2 = resolvePreferences({ shiftInvite: { email: false, sms: true } });
    expect(r2.shiftInvite).toEqual({ email: true, sms: true });
  });
  it("manager email always on, SMS respects stored", () => {
    const r = resolvePreferences({ dailyDigest: { email: false, sms: false } });
    expect(r.dailyDigest).toEqual({ email: true, sms: false });
  });
  it("null input yields email-on + SMS-off defaults everywhere", () => {
    const r = resolvePreferences(null);
    expect(r.shiftReminder).toEqual({ email: true, sms: false });
    expect(r.shiftInvite).toEqual({ email: true, sms: false });
    expect(r.beoSent).toEqual({ email: true, sms: false });
  });
});

describe("prefsFromFormData", () => {
  it("staff: email forced true, SMS reads form - even for required channels", () => {
    const checked = new Set(["pref_shiftReminder_sms", "pref_shiftInvite_sms"]);
    const getter = (k: string): FormDataEntryValue | null => (checked.has(k) ? "on" : null);
    const result = prefsFromFormData(getter, "staff");
    expect(result.shiftReminder).toEqual({ email: true, sms: true });
    expect(result.shiftInvite).toEqual({ email: true, sms: true });
    expect(result.beoSent).toEqual({ email: true, sms: false });
    expect("inviteResponse" in result).toBe(false); // other audience
  });
  it("manager: email forced true everywhere, SMS reads form", () => {
    const checked = new Set(["pref_staffCancellation_sms"]);
    const getter = (k: string): FormDataEntryValue | null => (checked.has(k) ? "on" : null);
    const result = prefsFromFormData(getter, "manager");
    expect(result.staffCancellation).toEqual({ email: true, sms: true });
    expect(result.urgentOpenShifts).toEqual({ email: true, sms: false });
    expect(result.dailyDigest).toEqual({ email: true, sms: false });
    expect(result.backupNudge).toEqual({ email: true, sms: false });
  });
  it("every audience channel appears in the result", () => {
    const getter = (): FormDataEntryValue | null => null;
    const r = prefsFromFormData(getter, "manager");
    const expected = NOTIFICATION_CHANNELS.filter((c) => c.audience === "manager").map((c) => c.key);
    for (const k of expected) expect(k in r).toBe(true);
  });
});
