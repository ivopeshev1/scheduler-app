/**
 * Permission tier helpers for manager-side accounts.
 *
 * Hierarchy:
 *   - Owner: one per company, created at signup. Can edit, suspend, and
 *     remove any other manager. Can't be touched by anyone.
 *   - Manager: everyone else with role === "manager". Can use the app
 *     (Calendar, Payroll, Staff log, etc.) within their granted flags,
 *     but cannot modify another manager or the owner.
 *
 * These functions are intentionally pure: they take plain objects, not
 * DB rows directly, so they're trivially unit-testable without touching
 * the database. The server actions wrap them with a DB load + revalidate.
 */

export type Actor = {
  id: string;
  companyId: string;
  role: "manager" | "staff";
  isOwner: boolean;
};

export type ManagerTarget = {
  id: string;
  companyId: string;
  role: "manager" | "staff";
  isOwner: boolean;
};

/**
 * Can `actor` modify (edit permissions, suspend, delete) `target`?
 * Rule: owner can touch any non-owner manager in the same company.
 * Nobody else can modify managers — not even themselves, not even
 * another manager with canAccessTeam. Owners also can't modify
 * themselves through this flow (they'd lock themselves out).
 */
export function canModifyManager(actor: Actor, target: ManagerTarget): boolean {
  if (!actor.isOwner) return false;
  if (actor.companyId !== target.companyId) return false;
  if (target.role !== "manager") return false;
  if (target.isOwner) return false;
  if (actor.id === target.id) return false;
  return true;
}

/**
 * Can `actor` add a new manager to their company? Owner only.
 */
export function canAddManager(actor: Actor): boolean {
  return actor.isOwner && actor.role === "manager";
}

/**
 * View-level gate for the Admin page. Owner always, plus any manager
 * the owner has given canAccessTeam to. Non-managers never.
 */
export function canViewAdminPage(actor: Actor & { canAccessTeam?: boolean }): boolean {
  if (actor.role !== "manager") return false;
  return !!actor.isOwner || !!actor.canAccessTeam;
}

/**
 * Decide whether a manager should be redirected to /manager/onboard
 * to fill in their profile. Owners who haven't filled in a profile
 * yet are nudged too, but they still have working access to the rest
 * of the app — so the UI should NOT hard-block, just redirect once
 * they land on a page that triggers this check.
 */
export function shouldOnboardManager(
  actor: Pick<Actor, "role">,
  hasProfile: boolean,
): boolean {
  if (actor.role !== "manager") return false;
  return !hasProfile;
}
