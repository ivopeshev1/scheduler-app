import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/notifications";
import { formatTime, formatDate } from "@/lib/format";

type EventRow = typeof schema.events.$inferSelect;

/**
 * Notify every staff member who has an invited or accepted invitation for this event
 * that the event was cancelled. Idempotent — won't re-notify once an invitation
 * is in 'expired' or 'rejected' status.
 */
export async function notifyCancellation(event: EventRow, companyId: string) {
  const positions = await db.select().from(schema.positions).where(eq(schema.positions.eventId, event.id));
  for (const p of positions) {
    const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, p.id));
    for (const inv of invites) {
      if (inv.status !== "pending" && inv.status !== "accepted") continue;
      if (!inv.sentAt) continue; // never actually notified in the first place — skip
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
      const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
      if (!u) continue;
      await sendEmail({
        to: u.email,
        subject: `CANCELLED: ${event.clientName} on ${formatDate(event.date)}`,
        body: [
          `Hi ${profile?.firstName ?? ""},`, ``,
          `The following event has been CANCELLED. You no longer need to attend.`, ``,
          `Client: ${event.clientName}`,
          `Date:   ${formatDate(event.date)}`,
          `Time:   ${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}`,
          `Role:   ${p.role}`, ``,
          `Sorry for the short notice.`,
        ].filter(Boolean).join("\n"),
        companyId,
        userId: inv.userId,
        relatedInvitationId: inv.id,
      });
    }
  }
}

/**
 * Notify invited+accepted staff that event-level details changed (date/time/venue/notes).
 */
export async function notifyEventDetailsChanged(event: EventRow, companyId: string, changeSummary: string) {
  const positions = await db.select().from(schema.positions).where(eq(schema.positions.eventId, event.id));
  for (const p of positions) {
    const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, p.id));
    for (const inv of invites) {
      if (inv.status !== "pending" && inv.status !== "accepted") continue;
      if (!inv.sentAt) continue;
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
      const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
      if (!u) continue;
      await sendEmail({
        to: u.email,
        subject: `Update: ${event.clientName} on ${formatDate(event.date)}`,
        body: [
          `Hi ${profile?.firstName ?? ""},`, ``,
          `The event you were invited to has been updated:`, ``,
          changeSummary, ``,
          `Current details:`,
          `Client: ${event.clientName}`,
          `Date:   ${formatDate(event.date)}`,
          `Time:   ${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}`,
          `Venue:  ${event.venue ?? ""} ${event.city ? `(${event.city})` : ""}`.trim(),
        ].join("\n"),
        companyId,
        userId: inv.userId,
        relatedInvitationId: inv.id,
      });
    }
  }
}

/**
 * Notify staff invited/accepted on a specific position that the position was removed from the event.
 */
export async function notifyPositionRemoved(
  event: EventRow,
  removedRole: string,
  invites: Array<typeof schema.invitations.$inferSelect>,
  companyId: string,
) {
  for (const inv of invites) {
    if (inv.status !== "pending" && inv.status !== "accepted") continue;
    if (!inv.sentAt) continue;
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
    const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
    if (!u) continue;
    await sendEmail({
      to: u.email,
      subject: `Position removed: ${event.clientName} on ${formatDate(event.date)}`,
      body: [
        `Hi ${profile?.firstName ?? ""},`, ``,
        `The ${removedRole} position you were invited to has been removed from this event.`,
        `You no longer need to attend.`, ``,
        `Client: ${event.clientName}`,
        `Date:   ${formatDate(event.date)}`,
      ].join("\n"),
      companyId,
      userId: inv.userId,
      relatedInvitationId: inv.id,
    });
  }
}
