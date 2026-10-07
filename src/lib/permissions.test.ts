import { describe, it, expect } from "vitest";
import { canModifyManager, canAddManager, canViewAdminPage, type Actor, type ManagerTarget } from "./permissions";

const owner: Actor = { id: "o1", companyId: "c1", role: "manager", isOwner: true };
const otherManager: Actor = { id: "m1", companyId: "c1", role: "manager", isOwner: false };
const staff: Actor = { id: "s1", companyId: "c1", role: "staff", isOwner: false };

const managerTarget: ManagerTarget = { id: "m2", companyId: "c1", role: "manager", isOwner: false };
const ownerTarget: ManagerTarget = { id: "o1", companyId: "c1", role: "manager", isOwner: true };
const foreignManager: ManagerTarget = { id: "m3", companyId: "c2", role: "manager", isOwner: false };
const staffTarget: ManagerTarget = { id: "s9", companyId: "c1", role: "staff", isOwner: false };

describe("canModifyManager", () => {
  it("lets the owner modify another manager in the same company", () => {
    expect(canModifyManager(owner, managerTarget)).toBe(true);
  });

  it("blocks the owner from modifying themselves (would lock them out)", () => {
    expect(canModifyManager(owner, ownerTarget)).toBe(false);
  });

  it("blocks any non-owner, even one with team access, from modifying another manager", () => {
    expect(canModifyManager(otherManager, managerTarget)).toBe(false);
  });

  it("blocks modification of the owner by anyone", () => {
    expect(canModifyManager(otherManager, ownerTarget)).toBe(false);
    expect(canModifyManager(owner, ownerTarget)).toBe(false);
  });

  it("blocks cross-company modification even if actor is an owner", () => {
    expect(canModifyManager(owner, foreignManager)).toBe(false);
  });

  it("blocks modification of a staff user through the manager flow", () => {
    expect(canModifyManager(owner, staffTarget)).toBe(false);
  });

  it("blocks staff role actors entirely", () => {
    expect(canModifyManager(staff, managerTarget)).toBe(false);
  });
});

describe("canAddManager", () => {
  it("only the owner can add a manager", () => {
    expect(canAddManager(owner)).toBe(true);
    expect(canAddManager(otherManager)).toBe(false);
    expect(canAddManager(staff)).toBe(false);
  });
});

describe("canViewAdminPage", () => {
  it("owner always sees the admin page", () => {
    expect(canViewAdminPage({ ...owner })).toBe(true);
  });

  it("a non-owner manager sees it only when granted canAccessTeam", () => {
    expect(canViewAdminPage({ ...otherManager, canAccessTeam: true })).toBe(true);
    expect(canViewAdminPage({ ...otherManager, canAccessTeam: false })).toBe(false);
    expect(canViewAdminPage({ ...otherManager })).toBe(false);
  });

  it("staff never sees it", () => {
    expect(canViewAdminPage({ ...staff, canAccessTeam: true })).toBe(false);
  });
});
