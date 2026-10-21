import { describe, it, expect } from "vitest";
import { buildIcs } from "./ics";

describe("buildIcs", () => {
  const base = {
    uid: "shift-abc@scheduler",
    summary: "Bartender at Alexandria Ballroom",
    date: "2027-01-01",
    startTime: "17:00",
    endTime: "22:00",
  };

  it("renders the required ICS skeleton", () => {
    const ics = buildIcs(base);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });
  it("formats DTSTART / DTEND as floating local times", () => {
    const ics = buildIcs(base);
    expect(ics).toContain("DTSTART:20270101T170000");
    expect(ics).toContain("DTEND:20270101T220000");
    expect(ics).not.toContain("TZID"); // floating, no tz
  });
  it("escapes commas, semicolons, backslashes and newlines in text fields", () => {
    const ics = buildIcs({ ...base, summary: "A, B; C\\D\nE", location: "x,y", description: "a;b" });
    expect(ics).toContain("SUMMARY:A\\, B\\; C\\\\D\\nE");
    expect(ics).toContain("LOCATION:x\\,y");
    expect(ics).toContain("DESCRIPTION:a\\;b");
  });
  it("omits LOCATION and DESCRIPTION when not supplied", () => {
    const ics = buildIcs(base);
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
  });
  it("uses CRLF line endings", () => {
    expect(buildIcs(base)).toContain("\r\n");
  });
});
