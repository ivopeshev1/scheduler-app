import { describe, it, expect } from "vitest";
import { acceptedCount, isPositionFull, pendingToRelease } from "./position-fill";

const inv = (id: string, status: any, extra: object = {}) => ({
  id,
  userId: `u-${id}`,
  status,
  ...extra,
});

describe("acceptedCount", () => {
  it("counts only accepted non-on-call non-cancelled rows", () => {
    expect(
      acceptedCount({
        needed: 3,
        invites: [
          inv("1", "accepted"),
          inv("2", "accepted"),
          inv("3", "pending"),
          inv("4", "rejected"),
          inv("5", "accepted", { cancelledAt: new Date() }),
          inv("6", "accepted", { isOnCall: true }),
        ],
      }),
    ).toBe(2);
  });

  it("returns 0 when nothing is accepted yet", () => {
    expect(
      acceptedCount({ needed: 2, invites: [inv("1", "pending")] }),
    ).toBe(0);
  });
});

describe("isPositionFull", () => {
  it("true when accepted equals needed", () => {
    expect(
      isPositionFull({
        needed: 2,
        invites: [inv("1", "accepted"), inv("2", "accepted")],
      }),
    ).toBe(true);
  });

  it("true when accepted exceeds needed (defensive)", () => {
    expect(
      isPositionFull({
        needed: 1,
        invites: [inv("1", "accepted"), inv("2", "accepted")],
      }),
    ).toBe(true);
  });

  it("false when short of needed", () => {
    expect(
      isPositionFull({
        needed: 3,
        invites: [inv("1", "accepted"), inv("2", "pending")],
      }),
    ).toBe(false);
  });

  it("on-call acceptance doesn't fill the position", () => {
    expect(
      isPositionFull({
        needed: 1,
        invites: [inv("1", "accepted", { isOnCall: true })],
      }),
    ).toBe(false);
  });
});

describe("pendingToRelease", () => {
  it("returns pending invites when the position just filled", () => {
    expect(
      pendingToRelease({
        needed: 1,
        invites: [
          inv("priority", "accepted"),
          inv("backup-a", "pending"),
          inv("backup-b", "pending"),
        ],
      }),
    ).toEqual(["backup-a", "backup-b"]);
  });

  it("returns empty when position isn't full yet", () => {
    expect(
      pendingToRelease({
        needed: 2,
        invites: [inv("1", "accepted"), inv("2", "pending")],
      }),
    ).toEqual([]);
  });

  it("skips on-call standby invitations even when full", () => {
    expect(
      pendingToRelease({
        needed: 1,
        invites: [
          inv("1", "accepted"),
          inv("standby", "pending", { isOnCall: true }),
          inv("backup", "pending"),
        ],
      }),
    ).toEqual(["backup"]);
  });

  it("skips invitations that were cancelled before fill (already released)", () => {
    expect(
      pendingToRelease({
        needed: 1,
        invites: [
          inv("1", "accepted"),
          inv("stale", "pending", { cancelledAt: new Date() }),
          inv("live", "pending"),
        ],
      }),
    ).toEqual(["live"]);
  });

  it("doesn't release rejected or expired rows (already terminal)", () => {
    expect(
      pendingToRelease({
        needed: 1,
        invites: [
          inv("1", "accepted"),
          inv("gone", "rejected"),
          inv("ghost", "expired"),
          inv("hold", "pending"),
        ],
      }),
    ).toEqual(["hold"]);
  });
});
