import { describe, it, expect } from "vitest";
import { generateCode, verifyCode, normalizePhone, phoneChanged } from "./phone-verification";

describe("generateCode", () => {
  it("returns a 6-digit numeric string", () => {
    const code = generateCode();
    expect(code).toMatch(/^\d{6}$/);
  });
  it("zero-pads small numbers", () => {
    expect(generateCode(() => 0)).toBe("000000");
    expect(generateCode(() => 0.00001)).toBe("000010");
  });
  it("handles the top of the range", () => {
    expect(generateCode(() => 0.9999999)).toBe("999999");
  });
});

describe("verifyCode", () => {
  const future = new Date("2026-10-20T12:00:00Z");
  const past = new Date("2026-10-20T11:00:00Z");
  const now = new Date("2026-10-20T11:30:00Z");

  it("rejects when no code is stored", () => {
    expect(verifyCode(null, future, "123456", now)).toEqual({ ok: false, reason: "no-code" });
    expect(verifyCode("123456", null, "123456", now)).toEqual({ ok: false, reason: "no-code" });
  });
  it("rejects when expired", () => {
    expect(verifyCode("123456", past, "123456", now)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects on mismatch", () => {
    expect(verifyCode("123456", future, "000000", now)).toEqual({ ok: false, reason: "mismatch" });
  });
  it("accepts a matching, unexpired code", () => {
    expect(verifyCode("123456", future, "123456", now)).toEqual({ ok: true });
  });
  it("trims whitespace in the submitted code", () => {
    expect(verifyCode("123456", future, "  123456 ", now)).toEqual({ ok: true });
  });
});

describe("normalizePhone", () => {
  it("strips formatting", () => {
    expect(normalizePhone("(555) 555-5555")).toBe("5555555555");
    expect(normalizePhone("555.555.5555")).toBe("5555555555");
    expect(normalizePhone(" 555 555 5555 ")).toBe("5555555555");
  });
  it("keeps leading +", () => {
    expect(normalizePhone("+1 (555) 555-5555")).toBe("+15555555555");
  });
  it("handles null / empty", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("phoneChanged", () => {
  it("ignores cosmetic differences", () => {
    expect(phoneChanged("(555) 555-5555", "5555555555")).toBe(false);
  });
  it("detects a real change", () => {
    expect(phoneChanged("(555) 555-5555", "(555) 555-5556")).toBe(true);
  });
  it("null -> value is a change", () => {
    expect(phoneChanged(null, "5555555555")).toBe(true);
  });
  it("value -> null is a change", () => {
    expect(phoneChanged("5555555555", null)).toBe(true);
  });
});
