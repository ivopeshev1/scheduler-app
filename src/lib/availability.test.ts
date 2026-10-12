import { describe, it, expect } from "vitest";
import { invitationBlocksDay } from "./availability";

const openEvent = { cancelledAt: null };
const cancelledEvent = { cancelledAt: new Date("2026-10-10T00:00:00Z") };

describe("invitationBlocksDay — statuses", () => {
  it("pending invitation blocks the day", () => {
    expect(invitationBlocksDay({ status: "pending" }, openEvent)).toBe(true);
  });

  it("accepted invitation blocks the day", () => {
    expect(invitationBlocksDay({ status: "accepted" }, openEvent)).toBe(true);
  });

  it("rejected invitation (staff declined) releases the day", () => {
    expect(invitationBlocksDay({ status: "rejected" }, openEvent)).toBe(false);
  });

  it("expired invitation (cron timeout) releases the day", () => {
    expect(invitationBlocksDay({ status: "expired" }, openEvent)).toBe(false);
  });

  it("filled invitation (pool slot taken by someone else) releases the day", () => {
    expect(invitationBlocksDay({ status: "filled" }, openEvent)).toBe(false);
  });
});

describe("invitationBlocksDay — cancellations", () => {
  it("manager-pulled accepted invitation (cancelled_at set) releases the day", () => {
    expect(
      invitationBlocksDay({ status: "accepted", cancelledAt: new Date() }, openEvent),
    ).toBe(false);
  });

  it("manager-pulled pending invitation releases the day", () => {
    expect(
      invitationBlocksDay({ status: "pending", cancelledAt: new Date() }, openEvent),
    ).toBe(false);
  });

  it("cancelled event releases every accepted invitation on it", () => {
    expect(invitationBlocksDay({ status: "accepted" }, cancelledEvent)).toBe(false);
  });

  it("cancelled event releases every pending invitation on it too", () => {
    expect(invitationBlocksDay({ status: "pending" }, cancelledEvent)).toBe(false);
  });
});

describe("invitationBlocksDay — regression guards", () => {
  it("staff-log Cancel path (status rejected + cancelled_at set) releases the day", () => {
    expect(
      invitationBlocksDay(
        { status: "rejected", cancelledAt: new Date() },
        openEvent,
      ),
    ).toBe(false);
  });

  it("on-call pending still blocks the day (standby reserves the staffer)", () => {
    expect(
      invitationBlocksDay({ status: "pending", isOnCall: true }, openEvent),
    ).toBe(true);
  });
});
