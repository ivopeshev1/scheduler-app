import { describe, it, expect } from "vitest";
import {
  userWantsNotification, resolvePreferences, prefsFromFormData,
  emailModeFor, shouldSendImmediateEmail, shouldIncludeInDigest,
  NOTIFICATION_CHANNELS,
} from "./notification-prefs";

describe("userWantsNotification", () => {
  it("email is always on everywhere", () => {
    expect(userWantsNotification(null, "shiftReminder", "email")).toBe(true);
    expect(userWantsNotification(null, "dailyDigest", "email")).toBe(true);
    expect(userWantsNotification({ dailyDigest: { email: false, sms: false } }, "dailyDigest", "email")).toBe(true);
    expect(userWantsNotification({ dailyDigest: false }, "dailyDigest", "email")).toBe(true);
  });
  it("SMS default off, respects stored value", () => {
    expect(userWantsNotification(null, "shiftReminder", "sms")).toBe(false);
    expect(userWantsNotification({ shiftReminder: { email: true, sms: true } }, "shiftReminder", "sms")).toBe(true);
    expect(userWantsNotification({ shiftReminder: { email: true, sms: false } }, "shiftReminder", "sms")).toBe(false);
  });
  it("legacy boolean row read for SMS", () => {
    expect(userWantsNotification({ shiftReminder: true }, "shiftReminder", "sms")).toBe(true);
    expect(userWantsNotification({ shiftReminder: false }, "shiftReminder", "sms")).toBe(false);
  });
});

describe("emailModeFor", () => {
  it("defaults to individual", () => {
    expect(emailModeFor(null, "inviteResponse")).toBe("individual");
    expect(emailModeFor({}, "inviteResponse")).toBe("individual");
  });
  it("reads stored mode when digestable", () => {
    expect(emailModeFor({ inviteResponse: { email: true, sms: false, emailMode: "summary" } }, "inviteResponse")).toBe("summary");
    expect(emailModeFor({ inviteResponse: { email: true, sms: false, emailMode: "both" } }, "inviteResponse")).toBe("both");
  });
  it("forces non-digestable channels to individual, no matter what's stored", () => {
    expect(emailModeFor({ urgentOpenShifts: { email: true, sms: false, emailMode: "summary" } }, "urgentOpenShifts")).toBe("individual");
    expect(emailModeFor({ staffCancellation: { email: true, sms: false, emailMode: "both" } }, "staffCancellation")).toBe("individual");
  });
});

describe("shouldSendImmediateEmail", () => {
  it("individual + both fire immediately", () => {
    expect(shouldSendImmediateEmail({ inviteResponse: { email: true, sms: false, emailMode: "individual" } }, "inviteResponse")).toBe(true);
    expect(shouldSendImmediateEmail({ inviteResponse: { email: true, sms: false, emailMode: "both" } }, "inviteResponse")).toBe(true);
  });
  it("summary does NOT fire immediately", () => {
    expect(shouldSendImmediateEmail({ inviteResponse: { email: true, sms: false, emailMode: "summary" } }, "inviteResponse")).toBe(false);
  });
  it("non-digestable channels always fire immediately regardless of stored mode", () => {
    expect(shouldSendImmediateEmail({ urgentOpenShifts: { email: true, sms: false, emailMode: "summary" } }, "urgentOpenShifts")).toBe(true);
  });
});

describe("shouldIncludeInDigest", () => {
  it("summary + both go into the digest", () => {
    expect(shouldIncludeInDigest({ inviteResponse: { email: true, sms: false, emailMode: "summary" } }, "inviteResponse")).toBe(true);
    expect(shouldIncludeInDigest({ inviteResponse: { email: true, sms: false, emailMode: "both" } }, "inviteResponse")).toBe(true);
  });
  it("individual does NOT go into the digest", () => {
    expect(shouldIncludeInDigest({ inviteResponse: { email: true, sms: false, emailMode: "individual" } }, "inviteResponse")).toBe(false);
  });
  it("non-digestable channels never go into the digest", () => {
    expect(shouldIncludeInDigest({ urgentOpenShifts: { email: true, sms: false, emailMode: "summary" } }, "urgentOpenShifts")).toBe(false);
  });
});

describe("resolvePreferences", () => {
  it("fills defaults", () => {
    const r = resolvePreferences(null);
    expect(r.inviteResponse).toEqual({ email: true, sms: false, emailMode: "individual" });
    expect(r.urgentOpenShifts).toEqual({ email: true, sms: false, emailMode: "individual" });
  });
  it("non-digestable channels can't store a mode other than individual", () => {
    const r = resolvePreferences({ urgentOpenShifts: { email: true, sms: true, emailMode: "summary" } });
    expect(r.urgentOpenShifts).toEqual({ email: true, sms: true, emailMode: "individual" });
  });
  it("digestable channels keep stored mode", () => {
    const r = resolvePreferences({ newStaffJoined: { email: true, sms: false, emailMode: "both" } });
    expect(r.newStaffJoined).toEqual({ email: true, sms: false, emailMode: "both" });
  });
});

describe("prefsFromFormData", () => {
  it("manager: SMS reads form, mode reads form only for digestable channels", () => {
    const checked = new Set(["pref_inviteResponse_sms", "pref_urgentOpenShifts_sms"]);
    const values: Record<string, string> = {
      pref_inviteResponse_mode: "summary",
      pref_newStaffJoined_mode: "both",
      pref_urgentOpenShifts_mode: "summary", // ignored; not digestable
    };
    const getter = (k: string): FormDataEntryValue | null => {
      if (k in values) return values[k];
      if (checked.has(k)) return "on";
      return null;
    };
    const result = prefsFromFormData(getter, "manager");
    expect(result.inviteResponse).toEqual({ email: true, sms: true, emailMode: "summary" });
    expect(result.newStaffJoined).toEqual({ email: true, sms: false, emailMode: "both" });
    expect(result.urgentOpenShifts).toEqual({ email: true, sms: true, emailMode: "individual" });
  });
  it("every manager-audience channel appears in the result", () => {
    const r = prefsFromFormData(() => null, "manager");
    const expected = NOTIFICATION_CHANNELS.filter((c) => c.audience === "manager").map((c) => c.key);
    for (const k of expected) expect(k in r).toBe(true);
  });
});
