import { db, schema } from "@/db/client";
import { and, eq, isNull } from "drizzle-orm";
import { sendEmail, escapeHtml } from "@/lib/notifications";
import { formatTime, formatDate } from "@/lib/format";
import { shellWrap, kvRow, kvTable, greeting, paragraph, banner, signoff } from "@/lib/email-html";
import { nanoid } from "nanoid";

type InvitationRow = typeof schema.invitations.$inferSelect;
type PositionRow = typeof schema.positions.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;

/**
 * Build and send the "Shift invitation" email to a specific staff member for a
 * specific invitation. Reused by both the manual "Send priority invites" flow
 * and the automatic backup-cascade flow, so the rendering stays in one place.
 * Sets sentAt on the invitation when done.
 */
export async function sendInvitationEmail(inv: InvitationRow, position: PositionRow, event: EventRow, companyId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
  if (!u) return;
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const companyName = company?.name ?? "Scheduler";
  const prettyDate = formatDate(event.date);
  const timeRange = `${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}`;
  const venue = `${event.venue ?? ""}${event.city ? ` (${event.city})` : ""}`.trim();

  const baseRateDisplay = (() => {
    if (position.baseRateMode === "standard") {
      const rate = profile?.defaultRate;
      const type = profile?.defaultRateType;
      if (rate == null) return "Your standard rate (to be confirmed with manager)";
      if (type === "hourly") return `Your standard rate ($${rate}/hr, as on file)`;
      if (type === "flat") return `Your standard rate ($${rate} flat, as on file)`;
      if (type === "both") return `Your standard rate ($${rate} - hourly or flat, per event, as on file)`;
      return `Your standard rate ($${rate}, as on file)`;
    }
    if (position.baseRateMode === "hourly") return `$${position.baseRate ?? 0}/hr (for this shift)`;
    return `$${position.baseRate ?? 0}`;
  })();
  const vanAmount = position.requiresVanDriving ? (position.vanDrivingRate ?? 0) : 0;
  const travel = inv.travelRate ?? 0;
  const vanLine = position.requiresVanDriving ? `This shift requires driving the van.` : "";
  const vanInstructions = position.requiresVanDriving && event.vanDrivingInstructions
    ? `Van driving instructions: ${event.vanDrivingInstructions}`
    : "";

  const compLinesText: string[] = [`Base rate:      ${baseRateDisplay}`];
  if (position.requiresVanDriving) compLinesText.push(`Van driving:    $${vanAmount}`);
  if (travel > 0) compLinesText.push(`Travel comp:    $${travel}`);

  const textBody = [
    `Hi ${profile?.firstName ?? ""},`, ``,
    `You're invited to work the following shift:`, ``,
    `Role:        ${position.role}`,
    event.eventType ? `Event type:  ${event.eventType}` : "",
    `Date:        ${prettyDate}`,
    `Approx time: ${timeRange}`,
    `Venue:       ${venue}`,
    `Client:      ${event.clientName}`, ``,
    `Compensation:`,
    ...compLinesText, ``,
    vanLine,
    vanInstructions,
    event.staffNotes ? `Notes: ${event.staffNotes}` : "",
    ``,
    `Accept or reject this shift at your staff dashboard.`, ``,
    `– ${companyName}`,
  ].filter(Boolean).join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#555;white-space:nowrap;">${label}</td><td style="padding:4px 0;">${value}</td></tr>`;

  const htmlBody = shellWrap([
    greeting(profile?.firstName, "You're invited to work the following shift:"),
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">
      ${row("Role", escapeHtml(position.role))}
      ${event.eventType ? row("Event type", escapeHtml(event.eventType)) : ""}
      ${row("Date", escapeHtml(prettyDate))}
      ${row("Approx time", escapeHtml(timeRange))}
      ${row("Venue", escapeHtml(venue))}
      ${row("Client", escapeHtml(event.clientName))}
    </table>`,
    `<p style="margin:0 0 8px;font-weight:600;">Compensation</p>`,
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">
      ${row("Base rate", escapeHtml(baseRateDisplay))}
      ${position.requiresVanDriving ? row("Van driving", `$${vanAmount}`) : ""}
      ${travel > 0 ? row("Travel comp", `$${travel}`) : ""}
    </table>`,
    vanLine ? `<p style="margin:0 0 12px;">${escapeHtml(vanLine)}</p>` : "",
    vanInstructions ? `<p style="margin:0 0 12px;color:#555;">${escapeHtml(vanInstructions)}</p>` : "",
    event.staffNotes ? `<p style="margin:0 0 12px;"><strong>Notes:</strong> ${escapeHtml(event.staffNotes)}</p>` : "",
    `<p style="margin:24px 0 0;">Accept or reject this shift at your staff dashboard.</p>`,
    signoff(companyName),
  ].filter(Boolean).join("\n"));

  await sendEmail({
    to: u.email,
    subject: `${companyName} invite to a shift - ${prettyDate}`,
    body: textBody,
    html: htmlBody,
    companyId,
    userId: inv.userId,
    relatedInvitationId: inv.id,
  });
  await db.update(schema.invitations).set({ sentAt: new Date() }).where(eq(schema.invitations.id, inv.id));
}

/**
 * Email the manager(s) of a company that a shift needs their attention because
 * auto-expiry fired and there was no backup to promote.
 */
async function notifyManagerNoBackup(event: EventRow, position: PositionRow, expiredForUserId: string, companyId: string) {
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const companyName = company?.name ?? "Scheduler";
  const managers = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.companyId, companyId), eq(schema.users.role, "manager"), isNull(schema.users.archivedAt)));
  const [expiredStaff] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, expiredForUserId));
  const prettyDate = formatDate(event.date);

  for (const m of managers) {
    const textBody = [
      `Hi,`, ``,
      `A priority invite just auto-expired and there's no backup queued to promote:`, ``,
      `Role:     ${position.role}`,
      `Date:     ${prettyDate}`,
      `Client:   ${event.clientName}`,
      `Expired:  ${expiredStaff?.firstName ?? ""} ${expiredStaff?.lastName ?? ""} never responded`, ``,
      `Open the event and invite someone new.`,
    ].filter(Boolean).join("\n");
    const htmlBody = shellWrap([
      `<p style="margin:0 0 12px;">Hi,</p>`,
      banner("⚠  Priority invite auto-expired, no backup available", "warning"),
      paragraph(`${expiredStaff?.firstName ?? ""} ${expiredStaff?.lastName ?? ""} never responded to their priority invite for this shift, and there are no backups queued.`),
      kvTable([
        kvRow("Role", position.role),
        kvRow("Date", prettyDate),
        kvRow("Client", event.clientName),
      ]),
      paragraph("Open the event page and invite someone new.", { muted: true }),
      signoff(companyName),
    ].join("\n"));
    await sendEmail({
      to: m.email,
      subject: `Action needed: ${event.clientName} on ${prettyDate} - no backup`,
      body: textBody,
      html: htmlBody,
      companyId,
      userId: m.id,
    });
  }
}

/**
 * The main auto-expiry + cascade pass. For each pending+sent priority invite
 * older than its company's priorityExpireDays threshold:
 *   1. Mark it expired
 *   2. If there's ANOTHER pending priority on the same position, stop - let it ride.
 *      (Manager invited multiple priorities on purpose; no need to cascade yet.)
 *   3. Otherwise look for the lowest-tier unsent backup draft on that position
 *      and promote it: set tier=0, sendAt = now, email it.
 *   4. If no backup exists, email the manager "action needed."
 *
 * Designed to be called from a daily cron (/api/cron/expire-invites). Idempotent
 * - re-running doesn't double-expire or double-notify.
 */
export async function runExpiryAndCascade() {
  const now = new Date();
  const results: Array<{ action: string; invId?: string; positionId?: string }> = [];

  // Pull all companies with auto-expiry turned on
  const companies = await db.select().from(schema.companies);
  for (const company of companies) {
    if (!company.priorityExpireDays || company.priorityExpireDays < 1) continue;
    const thresholdMs = company.priorityExpireDays * 24 * 60 * 60 * 1000;

    // All active invites tied to THIS company (join through positions → events)
    const rows = await db
      .select({ inv: schema.invitations, pos: schema.positions, ev: schema.events })
      .from(schema.invitations)
      .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
      .innerJoin(schema.events, eq(schema.positions.eventId, schema.events.id))
      .where(eq(schema.events.companyId, company.id));

    for (const row of rows) {
      const { inv, pos, ev } = row;
      if (inv.status !== "pending") continue;
      if (inv.tier !== 0) continue;       // only priority invites auto-expire
      if (!inv.sentAt) continue;           // drafts don't expire - they weren't emailed
      if (ev.cancelledAt) continue;        // skip cancelled events
      const age = now.getTime() - new Date(inv.sentAt).getTime();
      if (age < thresholdMs) continue;

      // Expire it
      await db.update(schema.invitations)
        .set({ status: "expired", respondedAt: now })
        .where(eq(schema.invitations.id, inv.id));
      results.push({ action: "expired", invId: inv.id });

      // Are there other priority pending invites still on this position? If so,
      // don't cascade - wait on them.
      const siblings = rows.filter((r) =>
        r.inv.positionId === pos.id &&
        r.inv.id !== inv.id &&
        r.inv.tier === 0 &&
        r.inv.status === "pending" &&
        r.inv.sentAt
      );
      if (siblings.length > 0) {
        results.push({ action: "skip-cascade-sibling-priority-pending", positionId: pos.id });
        continue;
      }

      // Find lowest-tier unsent backup draft on this position
      const backups = rows
        .filter((r) =>
          r.inv.positionId === pos.id &&
          r.inv.status === "pending" &&
          r.inv.tier > 0 &&
          !r.inv.sentAt
        )
        .sort((a, b) => a.inv.tier - b.inv.tier);

      if (backups.length > 0) {
        const promote = backups[0].inv;
        await db.update(schema.invitations)
          .set({ tier: 0 })
          .where(eq(schema.invitations.id, promote.id));
        // Re-fetch the promoted invite so sentAt lands on the latest row
        const [promoted] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, promote.id));
        if (promoted) {
          await sendInvitationEmail(promoted, pos, ev, company.id);
        }
        results.push({ action: "promoted-backup", invId: promote.id });
      } else {
        // No backup - ping the manager
        await notifyManagerNoBackup(ev, pos, inv.userId, company.id);
        results.push({ action: "notified-manager-no-backup", positionId: pos.id });
      }
    }
  }

  return results;
}
