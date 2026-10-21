import { describe, it, expect } from "vitest";
import { checkOnboardInvite, ageYearsFromDob, validateOnboardForm } from "./staff-onboarding";

describe("checkOnboardInvite", () => {
  const base = { userExists: true, isSuspended: false, isArchived: false, isOnboarded: false };

  it("accepts a brand-new staffer", () => {
    expect(checkOnboardInvite(base)).toEqual({ ok: true });
  });

  it("rejects an unknown token", () => {
    expect(checkOnboardInvite({ ...base, userExists: false })).toEqual({ ok: false, reason: "unknown" });
  });

  it("rejects a suspended account", () => {
    expect(checkOnboardInvite({ ...base, isSuspended: true })).toEqual({ ok: false, reason: "suspended" });
  });

  it("rejects an archived account", () => {
    expect(checkOnboardInvite({ ...base, isArchived: true })).toEqual({ ok: false, reason: "archived" });
  });

  it("redirects an already-onboarded staffer", () => {
    expect(checkOnboardInvite({ ...base, isOnboarded: true })).toEqual({ ok: false, reason: "already-onboarded" });
  });

  it("suspension takes priority over already-onboarded", () => {
    expect(
      checkOnboardInvite({ ...base, isSuspended: true, isOnboarded: true }),
    ).toEqual({ ok: false, reason: "suspended" });
  });
});

describe("ageYearsFromDob", () => {
  const on = new Date("2026-10-20T00:00:00Z");

  it("returns null for empty / malformed inputs", () => {
    expect(ageYearsFromDob(null, on)).toBeNull();
    expect(ageYearsFromDob("", on)).toBeNull();
    expect(ageYearsFromDob("not-a-date", on)).toBeNull();
  });

  it("computes age correctly after the birthday has passed this year", () => {
    expect(ageYearsFromDob("2000-05-01", on)).toBe(26);
  });

  it("doesn't count a birthday that hasn't happened yet", () => {
    expect(ageYearsFromDob("2000-12-01", on)).toBe(25);
  });

  it("handles birthday exactly today as the full age", () => {
    expect(ageYearsFromDob("2000-10-20", on)).toBe(26);
  });
});

describe("validateOnboardForm", () => {
  const good = {
    password: "longenough",
    confirm: "longenough",
    phone: "555-555-5555",
    dob: "1995-01-01",
    emergencyName: "Mom",
    emergencyPhone: "555-999-0000",
  };

  it("accepts a fully filled form", () => {
    expect(validateOnboardForm(good)).toBeNull();
  });

  it("rejects password mismatch", () => {
    expect(validateOnboardForm({ ...good, confirm: "different" })).toMatch(/don't match/);
  });

  it("rejects short passwords", () => {
    expect(validateOnboardForm({ ...good, password: "short", confirm: "short" })).toMatch(/at least 8/);
  });

  it("rejects missing phone", () => {
    expect(validateOnboardForm({ ...good, phone: "" })).toMatch(/phone number is required/);
  });

  it("rejects missing DOB", () => {
    expect(validateOnboardForm({ ...good, dob: "" })).toMatch(/Date of birth is required/);
  });

  it("rejects under-16 signups", () => {
    expect(validateOnboardForm({ ...good, dob: "2015-01-01" })).toMatch(/at least 16/);
  });

  it("rejects missing emergency contact", () => {
    expect(validateOnboardForm({ ...good, emergencyName: "" })).toMatch(/Emergency contact name/);
    expect(validateOnboardForm({ ...good, emergencyPhone: "" })).toMatch(/Emergency contact phone/);
  });
});
