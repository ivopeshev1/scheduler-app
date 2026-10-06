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
  // Split drafts into priority (tier 0) and backups (tier > 0) so the manager
  // sees "{name} + 3 backups" instead of a lumped "4 Backups" when the real
  // state is 1 priority draft + 3 backup drafts.
  const priorityDrafts = draftInvites.filter((i) => i.tier === 0);
  const backupDrafts = draftInvites.filter((i) => i.tier > 0);
  // "Open" = slots with no active priority invite out. Sent invites consume slots;
  // backups are waiting for cascade and don't reduce the open count. Clamp to 0 so
  // a position with more invites than slots doesn't go negative.
  const open = Math.max(0, total - filled - invited);

  async function firstNameOf(userId: string): Promise<string> {
    const [p] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId));
    return p?.firstName ?? "?";
  }

  // Append a "+N backups" suffix when there are extra backup invites waiting
  // in the wings. Keeps the primary label about the primary invitee.
  function backupSuffix(): string {
    const n = backupDrafts.length;
    if (n === 0) return "";
    return ` · +${n} backup${n === 1 ? "" : "s"}`;
  }

  // Single-slot: prefer showing the person's name so the manager sees at a glance who it is.
  if (total === 1) {
    if (filled === 1) {
      const acceptedSlot = slotRows.find((s) => s.acceptedUserId)!;
      return { label: await firstNameOf(acceptedSlot.acceptedUserId!), state: "confirmed" };
    }
    // Prefer the sent priority invite's name
    if (invited === 1) {
      return { label: `${await firstNameOf(sentPendingInvites[0].userId)}${backupSuffix()}`, state: "pending" };
    }
    if (invited > 1) {
      return { label: `${invited} Invited${backupSuffix()}`, state: "pending" };
    }
    // Nothing sent yet - a priority draft still shows as the primary name
    if (priorityDrafts.length === 1) {
      return { label: `${await firstNameOf(priorityDrafts[0].userId)}${backupSuffix()}`, state: "pending" };
    }
    if (priorityDrafts.length > 1) {
      return { label: `${priorityDrafts.length} Invited${backupSuffix()}`, state: "pending" };
    }
    // No priority at all, only backups queued
    if (backupDrafts.length === 1) {
      return { label: `${await firstNameOf(backupDrafts[0].userId)} (backup)`, state: "pending" };
    }
    if (backupDrafts.length > 1) {
      return { label: `${backupDrafts.length} Backups`, state: "pending" };
    }
    return { label: "Open", state: "pending" };
  }

  // Multi-slot
  if (filled === total) return { label: `${filled} Confirmed`, state: "confirmed" };
  const parts: string[] = [];
  if (filled > 0) parts.push(`${filled} Confirmed`);
  if (invited > 0) parts.push(`${invited} Invited`);
  // Priority drafts not yet sent read as "pending send" but visually count the
  // same as "Invited" for the manager - they're the next tier to go out.
  if (priorityDrafts.length > 0) parts.push(`${priorityDrafts.length} Pending`);
  if (backupDrafts.length > 0) parts.push(`${backupDrafts.length} ${backupDrafts.length === 1 ? "Backup" : "Backups"}`);
  if (open > 0) parts.push(`${open} Open`);
  return { label: parts.join(" / "), state: "pending" };
}
