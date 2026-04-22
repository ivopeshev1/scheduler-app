import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export type PositionStatus = {
  label: string;
  state: "pending" | "confirmed";
};

/**
 * Build the staffing-status label for a single position as it appears in the
 * month calendar and the event detail table. Rules:
 *
 *   Single-slot (needed=1):
 *     - Accepted: show the staff member's first name (black)
 *     - One invite sent, no accept: show the staff member's first name (red)
 *     - 2+ invites sent, no accept: "N Invited" (red)
 *     - No invites at all: "Open" (red)
 *
 *   Multi-slot (needed>1):
 *     - All slots accepted: "N Confirmed" (black)
 *     - Mixed: combine in stable order "X Confirmed / Y Invited / Z Open" (red)
 *
 * Ordering is always Confirmed → Invited → Open. All parts title-case.
 */
export async function summarizePosition(positionId: string): Promise<PositionStatus> {
  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.positionId, positionId));
  const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, positionId));

  const total = slotRows.length;
  const filled = slotRows.filter((s) => s.acceptedUserId).length;
  const sentPendingInvites = invites.filter((i) => i.status === "pending" && i.sentAt);
  const invited = sentPendingInvites.length;
  const open = total - filled;

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
    return { label: "Open", state: "pending" };
  }

  // Multi-slot
  if (filled === total) return { label: `${filled} Confirmed`, state: "confirmed" };
  const parts: string[] = [];
  if (filled > 0) parts.push(`${filled} Confirmed`);
  if (invited > 0) parts.push(`${invited} Invited`);
  if (open > 0) parts.push(`${open} Open`);
  return { label: parts.join(" / "), state: "pending" };
}
