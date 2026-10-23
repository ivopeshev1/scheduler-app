import { describe, it, expect } from "vitest";
import { shouldSendReminderNow, nowLocal, localDateString, addDays } from "./shift-reminders";

// Anchor on summer PDT so DST doesn't bite the tests.
// 2026-07-01T04:00:00Z = 21:00 PDT the previous day (= 2026-06-30 21:00 LA).
const JUL_1_4AM_UTC = new Date("2026-07-01T04:00:00Z");

describe("nowLocal", () => {
  it("returns local calendar + hour in LA", () => {
    expect(nowLocal(JUL_1_4AM_UTC, "America/Los_Angeles")).toEqual({
      year: 2026, month: 6, day: 30, hour: 21,
    });
  });
  it("returns local calendar + hour in UTC", () => {
    expect(nowLocal(JUL_1_4AM_UTC, "UTC")).toEqual({
      year: 2026, month: 7, day: 1, hour: 4,
    });
  });
});

describe("addDays", () => {
  it("rolls across months", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("localDateString", () => {
  it("returns YYYY-MM-DD in the given tz", () => {
    expect(localDateString(JUL_1_4AM_UTC, "America/Los_Angeles")).toBe("2026-06-30");
    expect(localDateString(JUL_1_4AM_UTC, "UTC")).toBe("2026-07-01");
  });
});

describe("shouldSendReminderNow — gating", () => {
  const base = {
    kind: "dayBefore" as const,
    shiftDate: "2026-07-01",
    chosenHour: 21,
    staffTz: "America/Los_Angeles",
    alreadySent: false,
    now: JUL_1_4AM_UTC, // = 21:00 LA on 2026-06-30
  };
  it("never fires when alreadySent", () => {
    expect(shouldSendReminderNow({ ...base, alreadySent: true })).toBe(false);
  });
  it("never fires when chosenHour is null (reminder off)", () => {
    expect(shouldSendReminderNow({ ...base, chosenHour: null })).toBe(false);
  });
  it("never fires when chosenHour is out of range", () => {
    expect(shouldSendReminderNow({ ...base, chosenHour: 25 })).toBe(false);
    expect(shouldSendReminderNow({ ...base, chosenHour: -1 })).toBe(false);
  });
});

describe("shouldSendReminderNow — dayBefore", () => {
  const base = {
    kind: "dayBefore" as const,
    shiftDate: "2026-07-01",
    chosenHour: 21,
    staffTz: "America/Los_Angeles",
    alreadySent: false,
    now: JUL_1_4AM_UTC, // 21:00 LA on 2026-06-30
  };
  it("fires at the exact local hour the day before the shift", () => {
    expect(shouldSendReminderNow(base)).toBe(true);
  });
  it("doesn't fire if local hour is off by one", () => {
    // 05:00 UTC = 22:00 PDT the previous day
    const nextHour = new Date("2026-07-01T05:00:00Z");
    expect(shouldSendReminderNow({ ...base, now: nextHour })).toBe(false);
  });
  it("doesn't fire on the shift day itself", () => {
    // 2026-07-02T04:00:00Z = 21:00 PDT on 2026-07-01 (shift day in LA)
    const shiftDay9pm = new Date("2026-07-02T04:00:00Z");
    expect(shouldSendReminderNow({ ...base, now: shiftDay9pm })).toBe(false);
  });
  it("falls back to America/Los_Angeles when staffTz is null", () => {
    expect(shouldSendReminderNow({ ...base, staffTz: null })).toBe(true);
  });
  it("falls back when staffTz is bogus", () => {
    expect(shouldSendReminderNow({ ...base, staffTz: "Not/A_Zone" })).toBe(true);
  });
});

describe("shouldSendReminderNow — morningOf", () => {
  const base = {
    kind: "morningOf" as const,
    shiftDate: "2026-07-01",
    chosenHour: 7,
    staffTz: "America/Los_Angeles",
    alreadySent: false,
  };
  // 2026-07-01T14:00:00Z = 07:00 PDT on 2026-07-01
  const sevenAm = new Date("2026-07-01T14:00:00Z");
  it("fires at the exact local hour on the shift day", () => {
    expect(shouldSendReminderNow({ ...base, now: sevenAm })).toBe(true);
  });
  it("fires late if we missed the exact tick (8am still counts)", () => {
    // 15:00 UTC = 08:00 PDT
    const eightAm = new Date("2026-07-01T15:00:00Z");
    expect(shouldSendReminderNow({ ...base, now: eightAm })).toBe(true);
  });
  it("does NOT fire earlier than the chosen hour", () => {
    // 13:00 UTC = 06:00 PDT
    const sixAm = new Date("2026-07-01T13:00:00Z");
    expect(shouldSendReminderNow({ ...base, now: sixAm })).toBe(false);
  });
  it("doesn't fire on the day before the shift", () => {
    // 2026-06-30T14:00:00Z = 07:00 PDT on 2026-06-30
    const dayBefore7am = new Date("2026-06-30T14:00:00Z");
    expect(shouldSendReminderNow({ ...base, now: dayBefore7am })).toBe(false);
  });
  it("doesn't fire the day AFTER (same hour, next day)", () => {
    // 2026-07-02T14:00:00Z = 07:00 PDT on 2026-07-02
    const dayAfter7am = new Date("2026-07-02T14:00:00Z");
    expect(shouldSendReminderNow({ ...base, now: dayAfter7am })).toBe(false);
  });
});
