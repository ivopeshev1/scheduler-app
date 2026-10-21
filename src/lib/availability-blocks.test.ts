import { describe, it, expect } from "vitest";
import { blocksCoverShift, describeBlock } from "./availability-blocks";

describe("blocksCoverShift", () => {
  const shift = { checkInTime: "17:00", endTime: "22:00" };

  it("returns false when no blocks", () => {
    expect(blocksCoverShift([], shift)).toBe(false);
  });
  it("whole-day block (both nulls) always blocks", () => {
    expect(blocksCoverShift([{ startTime: null, endTime: null }], shift)).toBe(true);
  });
  it("partial block that overlaps shift blocks it", () => {
    expect(blocksCoverShift([{ startTime: "18:00", endTime: "20:00" }], shift)).toBe(true);
    expect(blocksCoverShift([{ startTime: "16:00", endTime: "17:30" }], shift)).toBe(true);
    expect(blocksCoverShift([{ startTime: "21:30", endTime: "23:00" }], shift)).toBe(true);
  });
  it("partial block that ends exactly at shift start does NOT block", () => {
    expect(blocksCoverShift([{ startTime: "15:00", endTime: "17:00" }], shift)).toBe(false);
  });
  it("partial block that starts exactly at shift end does NOT block", () => {
    expect(blocksCoverShift([{ startTime: "22:00", endTime: "23:30" }], shift)).toBe(false);
  });
  it("partial block entirely outside the shift does NOT block", () => {
    expect(blocksCoverShift([{ startTime: "09:00", endTime: "12:00" }], shift)).toBe(false);
  });
  it("conservative: if shift window is unknown, any block blocks", () => {
    expect(blocksCoverShift([{ startTime: "09:00", endTime: "12:00" }], { checkInTime: null, endTime: "22:00" })).toBe(true);
    expect(blocksCoverShift([{ startTime: "09:00", endTime: "12:00" }], { checkInTime: null, endTime: null })).toBe(true);
  });
  it("evaluates every block, not just the first", () => {
    expect(
      blocksCoverShift(
        [
          { startTime: "08:00", endTime: "10:00" }, // doesn't overlap
          { startTime: "19:00", endTime: "20:00" }, // overlaps
        ],
        shift,
      ),
    ).toBe(true);
  });
});

describe("describeBlock", () => {
  it("whole day when both null", () => {
    expect(describeBlock({ startTime: null, endTime: null })).toBe("Whole day");
  });
  it("range in 12-hour by default", () => {
    expect(describeBlock({ startTime: "18:00", endTime: "23:00" })).toBe("6:00 PM – 11:00 PM");
  });
  it("range in 24-hour when asked", () => {
    expect(describeBlock({ startTime: "18:00", endTime: "23:00" }, false)).toBe("18:00 – 23:00");
  });
  it("From / Until when only one side set", () => {
    expect(describeBlock({ startTime: "14:00", endTime: null })).toBe("From 2:00 PM");
    expect(describeBlock({ startTime: null, endTime: "11:00" })).toBe("Until 11:00 AM");
  });
});
