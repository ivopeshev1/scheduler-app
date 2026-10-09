import { describe, it, expect } from "vitest";
import { computePayPeriod, movePayPeriod, computeTotalHours } from "./pay-period";

describe("computeTotalHours", () => {
  it("returns 0 for incomplete clock stamps", () => {
    expect(computeTotalHours(null, null, null, null)).toBe(0);
    expect(computeTotalHours("09:00", null, null, null)).toBe(0);
    expect(computeTotalHours(null, "17:00", null, null)).toBe(0);
  });

  it("computes basic shift with no break", () => {
    expect(computeTotalHours("09:00", "17:00", null, null)).toBe(8);
    expect(computeTotalHours("08:30", "12:00", null, null)).toBe(3.5);
  });

  it("subtracts the break window", () => {
    expect(computeTotalHours("09:00", "17:00", "12:00", "12:30")).toBe(7.5);
    expect(computeTotalHours("09:00", "17:00", "12:00", "13:00")).toBe(7);
  });

  it("handles shifts that cross midnight", () => {
    // 10 PM → 2 AM = 4 hours
    expect(computeTotalHours("22:00", "02:00", null, null)).toBe(4);
    // 11 PM → 7 AM minus 30-min break = 7.5 hours
    expect(computeTotalHours("23:00", "07:00", "03:00", "03:30")).toBe(7.5);
  });

  it("handles break that crosses midnight too", () => {
    expect(computeTotalHours("22:00", "06:00", "23:30", "00:00")).toBe(7.5);
  });

  it("ignores malformed break if either half is missing", () => {
    expect(computeTotalHours("09:00", "17:00", "12:00", null)).toBe(8);
    expect(computeTotalHours("09:00", "17:00", null, "12:30")).toBe(8);
  });

  it("never returns a negative number", () => {
    // Degenerate: equal times = 0, not negative
    expect(computeTotalHours("09:00", "09:00", null, null)).toBe(0);
  });

  it("rejects garbage clock values gracefully", () => {
    expect(computeTotalHours("bogus", "17:00", null, null)).toBe(0);
    expect(computeTotalHours("09:00", "garbage", null, null)).toBe(0);
  });
});

describe("computePayPeriod — weekly with anchor", () => {
  it("places the pay period on the anchor week when on == anchor", () => {
    const p = computePayPeriod("2026-01-05", "weekly", "2026-01-05");
    expect(p).toEqual({ start: "2026-01-05", end: "2026-01-11", cadence: "weekly" });
  });

  it("rolls forward one week when the reference is a week later", () => {
    const p = computePayPeriod("2026-01-12", "weekly", "2026-01-05");
    expect(p).toEqual({ start: "2026-01-12", end: "2026-01-18", cadence: "weekly" });
  });

  it("rolls backward correctly for dates before the anchor", () => {
    // Dec 29 is one week before Jan 5
    const p = computePayPeriod("2025-12-29", "weekly", "2026-01-05");
    expect(p).toEqual({ start: "2025-12-29", end: "2026-01-04", cadence: "weekly" });
  });

  it("picks the right period for a mid-period reference date", () => {
    // Jan 9 (Fri) is inside the Jan 5–11 period
    const p = computePayPeriod("2026-01-09", "weekly", "2026-01-05");
    expect(p).toEqual({ start: "2026-01-05", end: "2026-01-11", cadence: "weekly" });
  });

  it("falls back to Mon-Sun when no anchor is set", () => {
    // Jan 7 2026 is a Wednesday → Monday Jan 5
    const p = computePayPeriod("2026-01-07", "weekly", null);
    expect(p).toEqual({ start: "2026-01-05", end: "2026-01-11", cadence: "weekly" });
  });
});

describe("computePayPeriod — biweekly", () => {
  it("holds the 14-day window when reference is inside first period", () => {
    const p = computePayPeriod("2026-01-10", "biweekly", "2026-01-05");
    expect(p).toEqual({ start: "2026-01-05", end: "2026-01-18", cadence: "biweekly" });
  });

  it("advances to the next 14-day window", () => {
    const p = computePayPeriod("2026-01-19", "biweekly", "2026-01-05");
    expect(p).toEqual({ start: "2026-01-19", end: "2026-02-01", cadence: "biweekly" });
  });
});

describe("computePayPeriod — monthly", () => {
  it("always spans the full calendar month", () => {
    const jan = computePayPeriod("2026-01-15", "monthly", "2026-01-01");
    expect(jan).toEqual({ start: "2026-01-01", end: "2026-01-31", cadence: "monthly" });
    const feb = computePayPeriod("2026-02-10", "monthly", "2026-01-01");
    expect(feb).toEqual({ start: "2026-02-01", end: "2026-02-28", cadence: "monthly" });
  });
});

describe("movePayPeriod", () => {
  it("moves one week back and forward for weekly", () => {
    const base = computePayPeriod("2026-01-12", "weekly", "2026-01-05");
    expect(movePayPeriod(base, -1, "2026-01-05").start).toBe("2026-01-05");
    expect(movePayPeriod(base, 1, "2026-01-05").start).toBe("2026-01-19");
  });

  it("moves 14 days for biweekly", () => {
    const base = computePayPeriod("2026-01-05", "biweekly", "2026-01-05");
    const next = movePayPeriod(base, 1, "2026-01-05");
    expect(next).toEqual({ start: "2026-01-19", end: "2026-02-01", cadence: "biweekly" });
  });

  it("moves to adjacent calendar months for monthly", () => {
    const base = computePayPeriod("2026-01-15", "monthly", "2026-01-01");
    const next = movePayPeriod(base, 1, "2026-01-01");
    expect(next.start).toBe("2026-02-01");
    const prev = movePayPeriod(base, -1, "2026-01-01");
    expect(prev.start).toBe("2025-12-01");
  });
});
