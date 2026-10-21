/**
 * Who can see / act on what, scoped by physical location.
 *
 * Rule:
 *   - Owner → implicit access to every location in their company. Not
 *     represented in user_locations.
 *   - Non-owner manager / staff → only sees events + staff whose
 *     locationId is one of their assigned locations.
 *   - A legacy event with locationId=null (pre-locations backfill)
 *     stays visible to everyone in that company; the backfill is
 *     best-effort and we don't want to hide data from an owner just
 *     because migration raced the deploy.
 *
 * Pure — DB-free so the predicate is easy to unit-test. The server
 * actions wrap this with the actual user_locations lookup.
 */

export type AccessActor = {
  isOwner: boolean;
  // Location ids the actor has been assigned to. Empty array for owners
  // (they're implicit) and for users with no explicit assignment.
  locationIds: readonly string[];
};

export function canAccessLocation(actor: AccessActor, eventLocationId: string | null): boolean {
  if (actor.isOwner) return true;
  if (eventLocationId == null) return true; // legacy pre-backfill event
  return actor.locationIds.includes(eventLocationId);
}

/**
 * Filter helper: given a list of items with locationId, return only the
 * ones the actor can access. Keeps the "legacy null" rule consistent.
 */
export function filterByLocationAccess<T extends { locationId: string | null }>(
  actor: AccessActor,
  items: T[],
): T[] {
  if (actor.isOwner) return items;
  return items.filter((i) => canAccessLocation(actor, i.locationId));
}
