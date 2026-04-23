import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export type PositionStatus = {
  label: string;
  state: "pending" | "confirmed";
};

/**
 * Build the staffing-status label for a single position as it appears in the
 * month calendar and the event detail table. Invitation lifecycle stages we
 * report on, in priority order (left-to-right in multi-slot labels):
 *
 *   Confirmed  - slot has an accepted staff member. Locked in.
 *   Invited    - a priority invite email has been sent, awaiting response.
 *   Drafted    - manager has staged an invitation but hasn't sent the email yet.
 *                Still reserves the staff from being double-booked elsewhere.
 *   Open       - no activity on this slot.
 *
 * Single-slot positions show the person's first name when there's exactly one
 * name to show, so the manager sees at a glance who's on the shift.
 */
export async function summarizePosition(positionId: string): Promise<PositionStatus> {
  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.positionId, positionId));
  const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, positionId));

  const total = slotRows.length;
  const filled = slotRows.filter((s) => s.acceptedUserId).length;
  const sentPendingInvites = invites.filter((i) => i.status === "pending" && i.sentAt);
  const draftInvites = invites.filter((i) => i.status === "pending" && !i.sentAt);
  const invited = sentPendingInvites.length;
  const drafted = draftInvites.length;
  // "Open" = slots with no active priority invite out. Sent invites consume slots;
  // backups are waiting for cascade and don't reduce the open count. Clamp to 0 so
  // a position with more invites than slots doesn't go negative.
  const open = Math.max(0, total - filled - invited);

  async function firstNameOf(userId: string): Promise<string> {
    const [p] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId));
    return p?.firstName ?? "?";
  }

  // Single-slot: prefer showing the person's name so the manager sees at a glance who it is.
  if (total === 1) {
    if (filled === 1) {
      const acceptedSlot = slotRows.find((s) => s.acceptedUserId)!;
      return { label: await firstNameOf(acceptedSlot.acceptedUserId!), state: "confirmed" };
    }
    if (invited === 1) {
      return { label: await firstNameOf(sentPendingInvites[0].userId), state: "pending" };
    }
    if (invited > 1) {
      return { label: `${invited} Invited`, state: "pending" };
    }
    // No sent invites; is there a draft (i.e., a backup queued but not yet emailed)?
    if (drafted === 1) {
      return { label: `${await firstNameOf(draftInvites[0].userId)} (backup)`, state: "pending" };
    }
    if (drafted > 1) {
      return { label: `${drafted} Backups`, state: "pending" };
    }
    return { label: "Open", state: "pending" };
  }

  // Multi-slot
  if (filled === total) return { label: `${filled} Confirmed`, state: "confirmed" };
  const parts: string[] = [];
  if (filled > 0) parts.push(`${filled} Confirmed`);
  if (invited > 0) parts.push(`${invited} Invited`);
  if (drafted > 0) parts.push(`${drafted} ${drafted === 1 ? "Backup" : "Backups"}`);
  if (open > 0) parts.push(`${open} Open`);
  return { label: parts.join(" / "), state: "pending" };
}
