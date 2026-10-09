import { describe, it, expect } from "vitest";
import { resolveRate, shiftPay } from "./shift-pay";

const noOverride = { rateOverrideAmount: null, rateOverrideMode: null };
const standardPos = { role: "Bartender", baseRateMode: "standard" as const, baseRate: null };
const flatPos = { role: "Bartender", baseRateMode: "flat" as const, baseRate: 300 };
const hourlyPos = { role: "Bartender", baseRateMode: "hourly" as const, baseRate: 40 };
const emptyProfile = { defaultRate: null, defaultRateType: null };
const hourlyProfile = { defaultRate: 35, defaultRateType: "hourly" as const };
const flatProfile = { defaultRate: 250, defaultRateType: "flat" as const };

describe("resolveRate", () => {
  it("per-invite override wins over everything else", () => {
    const r = resolveRate(
      { rateOverrideAmount: 500, rateOverrideMode: "flat" },
      hourlyPos,
      hourlyProfile,
      { rate: 45, rateType: "hourly" },
    );
    expect(r).toEqual({ rate: 500, rateType: "flat" });
  });

  it("position flat rate wins when no override", () => {
    const r = resolveRate(noOverride, flatPos, hourlyProfile, { rate: 45, rateType: "hourly" });
    expect(r).toEqual({ rate: 300, rateType: "flat" });
  });

  it("position hourly rate wins when no override", () => {
    const r = resolveRate(noOverride, hourlyPos, flatProfile, { rate: 500, rateType: "flat" });
    expect(r).toEqual({ rate: 40, rateType: "hourly" });
  });

  it("standard mode falls back to per-role catalog rate", () => {
    const r = resolveRate(noOverride, standardPos, hourlyProfile, { rate: 50, rateType: "hourly" });
    expect(r).toEqual({ rate: 50, rateType: "hourly" });
  });

  it("standard mode uses profile default when no per-role rate exists", () => {
    const r = resolveRate(noOverride, standardPos, hourlyProfile, null);
    expect(r).toEqual({ rate: 35, rateType: "hourly" });
  });

  it("falls back to 0/hourly when profile has nothing set either", () => {
    const r = resolveRate(noOverride, standardPos, emptyProfile, null);
    expect(r).toEqual({ rate: 0, rateType: "hourly" });
  });

  it("treats legacy 'both' profile type as hourly in the fallback", () => {
    const r = resolveRate(
      noOverride,
      standardPos,
      { defaultRate: 30, defaultRateType: "both" },
      null,
    );
    expect(r).toEqual({ rate: 30, rateType: "hourly" });
  });

  it("respects override mode when the staffer specifies flat vs hourly", () => {
    const r = resolveRate(
      { rateOverrideAmount: 42, rateOverrideMode: "hourly" },
      flatPos,
      flatProfile,
      null,
    );
    expect(r).toEqual({ rate: 42, rateType: "hourly" });
  });
});

describe("shiftPay", () => {
  it("returns on-call fee for on-call shifts, ignoring rate/hours", () => {
    expect(shiftPay({ isOnCall: true, onCallFee: 50, rate: 999, rateType: "hourly", hours: 10 })).toBe(50);
  });

  it("on-call with no company fee set returns 0", () => {
    expect(shiftPay({ isOnCall: true, rate: 40, rateType: "hourly", hours: 8 })).toBe(0);
  });

  it("flat shift adds rate and gratuity", () => {
    expect(shiftPay({ rate: 300, rateType: "flat", gratuity: 50 })).toBe(350);
  });

  it("flat shift without gratuity returns rate alone", () => {
    expect(shiftPay({ rate: 300, rateType: "flat" })).toBe(300);
  });

  it("hourly shift multiplies rate by hours and adds gratuity", () => {
    expect(shiftPay({ rate: 35, rateType: "hourly", hours: 8, gratuity: 20 })).toBe(300);
  });

  it("hourly shift with no hours stamped yet returns just the gratuity", () => {
    expect(shiftPay({ rate: 35, rateType: "hourly", gratuity: 15 })).toBe(15);
  });

  it("hourly shift with partial hours is proportional", () => {
    expect(shiftPay({ rate: 40, rateType: "hourly", hours: 7.5 })).toBe(300);
  });

  it("gratuity of null is treated as 0", () => {
    expect(shiftPay({ rate: 40, rateType: "hourly", hours: 8, gratuity: null })).toBe(320);
  });
});
