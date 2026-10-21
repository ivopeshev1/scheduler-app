import { describe, it, expect } from "vitest";
import { canAccessLocation, filterByLocationAccess } from "./location-access";

describe("canAccessLocation", () => {
  it("owners see every location regardless of assignment", () => {
    expect(canAccessLocation({ isOwner: true, locationIds: [] }, "la")).toBe(true);
    expect(canAccessLocation({ isOwner: true, locationIds: [] }, "ny")).toBe(true);
  });

  it("non-owner sees locations they're assigned to", () => {
    expect(canAccessLocation({ isOwner: false, locationIds: ["la"] }, "la")).toBe(true);
  });

  it("non-owner is blocked from other locations", () => {
    expect(canAccessLocation({ isOwner: false, locationIds: ["la"] }, "ny")).toBe(false);
  });

  it("non-owner with multiple assignments sees all of them", () => {
    const actor = { isOwner: false, locationIds: ["la", "ny"] };
    expect(canAccessLocation(actor, "la")).toBe(true);
    expect(canAccessLocation(actor, "ny")).toBe(true);
    expect(canAccessLocation(actor, "chi")).toBe(false);
  });

  it("legacy events (locationId=null) are visible to everyone", () => {
    // Backfill is best-effort; we don't want to silently hide an event
    // from the manager who created it just because migration raced.
    expect(canAccessLocation({ isOwner: false, locationIds: [] }, null)).toBe(true);
  });

  it("non-owner with zero assignments and a scoped event is blocked", () => {
    expect(canAccessLocation({ isOwner: false, locationIds: [] }, "la")).toBe(false);
  });
});

describe("filterByLocationAccess", () => {
  const events = [
    { id: "e1", locationId: "la" },
    { id: "e2", locationId: "ny" },
    { id: "e3", locationId: null },
  ];

  it("owners get the full list", () => {
    expect(filterByLocationAccess({ isOwner: true, locationIds: [] }, events)).toHaveLength(3);
  });

  it("non-owner with LA access gets LA + legacy", () => {
    const filtered = filterByLocationAccess({ isOwner: false, locationIds: ["la"] }, events);
    expect(filtered.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("non-owner with no assignments gets only legacy", () => {
    const filtered = filterByLocationAccess({ isOwner: false, locationIds: [] }, events);
    expect(filtered.map((e) => e.id)).toEqual(["e3"]);
  });
});
