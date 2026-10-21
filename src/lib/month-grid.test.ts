import { describe, it, expect } from "vitest";
import {
  parseMonthSlug, monthSlug, shiftMonth, daysInMonth, firstWeekdayOfMonth,
  buildMonthGrid, monthLabel,
} from "./month-grid";

describe("parseMonthSlug", () => {
  const today = new Date("2026-10-20T00:00:00Z");
  it("parses a valid slug", () => {
    expect(parseMonthSlug("2026-03", today)).toEqual({ year: 2026, month: 3 });
  });
  it("falls back on missing input", () => {
    expect(parseMonthSlug(undefined, today)).toEqual({ year: 2026, month: 10 });
  });
  it("falls back on bogus input", () => {
    expect(parseMonthSlug("not-a-date", today)).toEqual({ year: 2026, month: 10 });
    expect(parseMonthSlug("2026-13", today)).toEqual({ year: 2026, month: 10 });
  });
});

describe("monthSlug", () => {
  it("zero-pads single-digit months", () => {
    expect(monthSlug(2026, 3)).toBe("2026-03");
    expect(monthSlug(2026, 11)).toBe("2026-11");
  });
});

describe("shiftMonth", () => {
  it("adds within year", () => {
    expect(shiftMonth(2026, 3, 2)).toEqual({ year: 2026, month: 5 });
  });
  it("rolls forward across year", () => {
    expect(shiftMonth(2026, 11, 3)).toEqual({ year: 2027, month: 2 });
  });
  it("rolls back across year", () => {
    expect(shiftMonth(2026, 2, -3)).toEqual({ year: 2025, month: 11 });
  });
});

describe("daysInMonth", () => {
  it("handles 31-day months", () => expect(daysInMonth(2026, 1)).toBe(31));
  it("handles 30-day months", () => expect(daysInMonth(2026, 4)).toBe(30));
  it("handles non-leap February", () => expect(daysInMonth(2026, 2)).toBe(28));
  it("handles leap February", () => expect(daysInMonth(2024, 2)).toBe(29));
});

describe("firstWeekdayOfMonth", () => {
  it("returns Thursday=4 for 2026-10", () => {
    expect(firstWeekdayOfMonth(2026, 10)).toBe(4);
  });
});

describe("buildMonthGrid", () => {
  it("returns 42 cells", () => {
    expect(buildMonthGrid(2026, 10)).toHaveLength(42);
  });
  it("includes every day of the month exactly once", () => {
    const grid = buildMonthGrid(2026, 10);
    const inMonth = grid.filter((c) => c.inMonth);
    expect(inMonth.map((c) => c.day)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });
  it("pads with previous month's tail at the start", () => {
    const grid = buildMonthGrid(2026, 10); // Oct 1 is Thu, so Sep 27-30 pad
    expect(grid.slice(0, 4).map((c) => c.iso)).toEqual([
      "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30",
    ]);
  });
});

describe("monthLabel", () => {
  it("formats month name + year", () => {
    expect(monthLabel(2026, 10)).toBe("October 2026");
  });
});
