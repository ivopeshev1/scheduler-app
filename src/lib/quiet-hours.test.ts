import { describe, it, expect } from "vitest";
import { isInQuietHours, nowMinutesInTz } from "./quiet-hours";

// Pin everything to a UTC instant and pick timezones with known offsets so
// the tests don't drift with daylight-saving changes at build time: we
// anchor on 2026-07-01T04:00:00Z, which is 21:00 PDT the previous day in
// America/Los_Angeles (summer, UTC-7).
const JULY_1_4AM_UTC = new Date("2026-07-01T04:00:00Z");

describe("nowMinutesInTz", () => {
  it("returns the right local clock minutes", () => {
    // 04:00 UTC → 21:00 PDT → 21*60 = 1260
    expect(nowMinutesInTz(JULY_1_4AM_UTC, "America/Los_Angeles")).toBe(21 * 60);
    // 04:00 UTC → 00:00 UTC → 0
    expect(nowMinutesInTz(JULY_1_4AM_UTC, "UTC")).toBe(4 * 60);
  });
});

describe("isInQuietHours", () => {
  const la = "America/Los_Angeles";

  it("off when either end is missing", () => {
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: null, end: "08:00", tz: la })).toBe(false);
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "21:00", end: null, tz: la })).toBe(false);
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: null, end: null, tz: la })).toBe(false);
  });
  it("off when start == end (treated as disabled)", () => {
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "22:00", end: "22:00", tz: la })).toBe(false);
  });
  it("same-day window: inside blocks, outside doesn't", () => {
    // At 21:00 PDT with a 09:00-17:00 window: outside → false
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "09:00", end: "17:00", tz: la })).toBe(false);
    // At 21:00 PDT with a 20:00-22:00 window: inside → true
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "20:00", end: "22:00", tz: la })).toBe(true);
  });
  it("wrap-around window: 21:00–08:00 blocks evenings AND early mornings", () => {
    // At 21:00 PDT (start of window) → true
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "21:00", end: "08:00", tz: la })).toBe(true);
    // Pick an instant that lands at 2 AM LA: 09:00 UTC = 02:00 PDT.
    const twoAmLa = new Date("2026-07-01T09:00:00Z");
    expect(isInQuietHours(twoAmLa, { start: "21:00", end: "08:00", tz: la })).toBe(true);
    // Noon LA (19:00 UTC) → outside wrap window
    const noonLa = new Date("2026-07-01T19:00:00Z");
    expect(isInQuietHours(noonLa, { start: "21:00", end: "08:00", tz: la })).toBe(false);
  });
  it("half-open window: 8:00 sharp is outside the quiet range", () => {
    // 15:00 UTC on 2026-07-01 = 08:00 PDT exactly
    const eightAmLa = new Date("2026-07-01T15:00:00Z");
    expect(isInQuietHours(eightAmLa, { start: "21:00", end: "08:00", tz: la })).toBe(false);
  });
  it("falls back to America/Los_Angeles when tz is bogus / null", () => {
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "20:00", end: "22:00", tz: null })).toBe(true);
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "20:00", end: "22:00", tz: "Not/A_Real_Zone" })).toBe(true);
  });
  it("malformed HH:MM is ignored (treated as unset)", () => {
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "nope", end: "08:00", tz: la })).toBe(false);
    expect(isInQuietHours(JULY_1_4AM_UTC, { start: "25:99", end: "08:00", tz: la })).toBe(false);
  });
});
