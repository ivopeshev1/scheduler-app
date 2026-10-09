import { describe, it, expect } from "vitest";
import { checkResetToken, tokenExpiry, validateNewPassword, TOKEN_TTL_MS } from "./password-reset";

const now = new Date("2026-10-07T12:00:00Z");
const future = new Date(now.getTime() + 1000 * 60 * 60); // +1h
const past = new Date(now.getTime() - 1000 * 60 * 60); // -1h

describe("checkResetToken", () => {
  it("rejects an unknown token (null row from DB)", () => {
    expect(checkResetToken(null, now)).toEqual({ ok: false, reason: "unknown" });
  });

  it("accepts a fresh, unused token", () => {
    const row = { token: "t", userId: "u1", createdAt: now, expiresAt: future, usedAt: null };
    expect(checkResetToken(row, now)).toEqual({ ok: true, userId: "u1" });
  });

  it("rejects a token already marked used", () => {
    const row = { token: "t", userId: "u1", createdAt: now, expiresAt: future, usedAt: now };
    expect(checkResetToken(row, now)).toEqual({ ok: false, reason: "used" });
  });

  it("rejects a token past its expiry", () => {
    const row = { token: "t", userId: "u1", createdAt: past, expiresAt: past, usedAt: null };
    expect(checkResetToken(row, now)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token whose expiry is exactly now (boundary)", () => {
    const row = { token: "t", userId: "u1", createdAt: past, expiresAt: now, usedAt: null };
    expect(checkResetToken(row, now)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("tokenExpiry", () => {
  it("returns a date 24 hours in the future", () => {
    expect(tokenExpiry(now).getTime() - now.getTime()).toBe(TOKEN_TTL_MS);
  });
});

describe("validateNewPassword", () => {
  it("accepts a reasonable password", () => {
    expect(validateNewPassword("goodpassword")).toBeNull();
    expect(validateNewPassword("Correct Horse Battery")).toBeNull();
  });

  it("rejects too-short passwords", () => {
    expect(validateNewPassword("short")).toMatch(/at least 8/);
    expect(validateNewPassword("")).toMatch(/at least 8/);
  });

  it("rejects passwords with leading or trailing whitespace", () => {
    expect(validateNewPassword(" leadingspace")).toMatch(/space/);
    expect(validateNewPassword("trailingspace ")).toMatch(/space/);
  });

  it("rejects whitespace-only passwords", () => {
    expect(validateNewPassword("        ")).not.toBeNull();
  });
});
