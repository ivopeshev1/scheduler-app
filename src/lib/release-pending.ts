import { db, schema } from "@/db/client";
import { eq, inArray } from "drizzle-orm";
import { pendingToRelease } from "@/lib/position-fill";
import { notifyPositionFilled } from "@/lib/event-notifications";

/**
 * After an acceptance that may have filled a position, drop any pending
 * backups that were being held in reserve: flip them to status='filled'
 * (which the availability predicate already treats as "released"), null
 * their slot ref, and notify them so they're not left wondering.
 *
 * Idempotent — safe to call after every acceptance / activation / manual
 * slot bind. If the position isn't full yet, nothing happens.
 */
export async function releasePendingIfPositionFilled(
  positionId: string,
  companyId: string,
): Promise<string[]> {
  const [position] = await db
    .select()
    .from(schema.positions)
    .where(eq(schema.positions.id, positionId));
  if (!position) return [];

  const invites = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.positionId, positionId));

  const idsToRelease = pendingToRelease({
    needed: position.needed,
    invites: invites.map((i) => ({
      id: i.id,
      status: i.status,
      isOnCall: i.isOnCall,
      cancelledAt: i.cancelledAt,
      userId: i.userId,
    })),
  });

  if (idsToRelease.length === 0) return [];

  // Flip in bulk. Status 'filled' means "there was a slot but someone
  // else took it" — distinct from rejected/expired/cancelled so the
  // staffer's Compare metrics don't blame them.
  await db
    .update(schema.invitations)
    .set({ status: "filled", slotId: null })
    .where(inArray(schema.invitations.id, idsToRelease));

  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, position.eventId));
  if (event) {
    await notifyPositionFilled(event, position.role, idsToRelease, companyId);
  }

  return idsToRelease;
}
