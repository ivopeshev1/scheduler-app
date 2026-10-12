import { describe, it, expect } from "vitest";
import { classifyDigest, hoursUntilShift } from "./digest";

const now = new Date("2026-10-20T12:00:00Z");

const base = {
  invitationId: "i1",
  status: "pending" as const,
  tier: 0,
  sentAt: new Date("2026-10-18T09:00:00Z"),
  respondedAt: null,
  cancelledAt: null,
  isOnCall: null,
  userFirstName: "Boris",
  userLastName: "Petrov",
  eventId: "e1",
  eventClientName: "Smith Wedding",
  eventDate: "2026-10-25",
  eventCheckInTime: "16:00",
  positionRole: "Bartender",
  positionNeeded: 2,
  positionAcceptedCount: 1,
  positionHasPendingBackup: false,
};

describe("hoursUntilShift", () => {
  it("returns positive hours for future shifts", () => {
    const h = hoursUntilShift("2026-10-21", "12:00", now);
    expect(h).toBeCloseTo(24, 0);
  });

  it("returns negative hours for past shifts", () => {
    const h = hoursUntilShift("2026-10-19", "12:00", now);
    expect(h).toBeCloseTo(-24, 0);
  });

  it("falls back to noon when check-in time is missing", () => {
    const h = hoursUntilShift("2026-10-20", null, now);
    expect(h).toBe(0); // noon = now
  });
});

describe("classifyDigest — urgent bucket", () => {
  // "soon" = same-day shift, within the 24h threshold
  const soon = { eventDate: "2026-10-20", eventCheckInTime: "22:00" };
  // "far" = 8 days out, well outside the threshold
  const far = { eventDate: "2026-10-28", eventCheckInTime: "16:00" };

  it("flags a position with open slots inside the threshold", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [{ ...base, ...soon }],
    });
    expect(r.urgent).toHaveLength(1);
    expect(r.urgent[0].message).toMatch(/open slot/);
    expect(r.waiting).toHaveLength(0);
  });

  it("adds a 'no backup!' warning when nothing is lined up", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [{ ...base, ...soon, positionHasPendingBackup: false }],
    });
    expect(r.urgent[0].message).toMatch(/no backup/i);
  });

  it("does NOT flag when a position is already full", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [{ ...base, ...soon, positionAcceptedCount: 2 }],
    });
    expect(r.urgent).toHaveLength(0);
  });

  it("does NOT flag when shift is past the threshold", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [{ ...base, ...far }],
    });
    expect(r.urgent).toHaveLength(0);
  });

  it("emits urgent once per position even with multiple pending invites", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [
        { ...base, ...soon, invitationId: "a" },
        { ...base, ...soon, invitationId: "b" },
      ],
    });
    expect(r.urgent).toHaveLength(1);
  });
});

describe("classifyDigest — waiting bucket", () => {
  it("flags pending priority outside the urgent window", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [{ ...base, eventDate: "2026-10-27", positionHasPendingBackup: true }],
    });
    expect(r.waiting).toHaveLength(1);
    expect(r.waiting[0].message).toMatch(/backups lined up/);
  });

  it("skips a pending backup (only priority counts here)", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [{ ...base, tier: 1, eventDate: "2026-10-27" }],
    });
    expect(r.waiting).toHaveLength(0);
  });
});

describe("classifyDigest — resolved bucket", () => {
  it("includes acceptances from the last 24h", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [
        {
          ...base,
          status: "accepted",
          respondedAt: new Date("2026-10-20T06:00:00Z"),
          eventDate: "2026-10-27",
        },
      ],
    });
    expect(r.resolved).toHaveLength(1);
    expect(r.resolved[0].message).toMatch(/accepted/);
  });

  it("skips acceptances older than 24h", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [
        {
          ...base,
          status: "accepted",
          respondedAt: new Date("2026-10-18T06:00:00Z"),
          eventDate: "2026-10-27",
        },
      ],
    });
    expect(r.resolved).toHaveLength(0);
  });

  it("marks removed-by-manager rows distinctly from declines", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [
        {
          ...base,
          status: "rejected",
          respondedAt: new Date("2026-10-20T06:00:00Z"),
          cancelledAt: new Date("2026-10-20T06:00:00Z"),
          eventDate: "2026-10-27",
        },
      ],
    });
    expect(r.resolved[0].message).toMatch(/was removed/);
  });
});

describe("classifyDigest — overview", () => {
  it("counts unique events and slot totals", () => {
    const r = classifyDigest({
      now,
      urgentThresholdHours: 24,
      invites: [
        { ...base, eventId: "e1", eventDate: "2026-10-25" },
        { ...base, eventId: "e1", eventDate: "2026-10-25", invitationId: "x2" },
        { ...base, eventId: "e2", eventDate: "2026-10-28", positionRole: "Server", positionNeeded: 3, positionAcceptedCount: 0 },
      ],
    });
    expect(r.overview.upcomingEvents).toBe(2);
    expect(r.overview.totalPositions).toBe(2);
    expect(r.overview.confirmedSlots).toBe(1);
    expect(r.overview.openSlots).toBe(1 + 3);
  });
});
