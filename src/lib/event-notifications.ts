import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/notifications";
import { formatTime, formatDate } from "@/lib/format";
import { shellWrap, kvRow, kvTable, greeting, paragraph, banner, signoff } from "@/lib/email-html";

type EventRow = typeof schema.events.$inferSelect;

async function getCompanyName(companyId: string): Promise<string> {
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  return c?.name ?? "Scheduler";
}

/**
 * Notify every staff member who has an invited or accepted invitation for this event
 * that the event was cancelled. Idempotent - won't re-notify once an invitation
 * is in 'expired' or 'rejected' status.
 */
export async function notifyCancellation(event: EventRow, companyId: string) {
  const companyName = await getCompanyName(companyId);
  const prettyDate = formatDate(event.date);
  const timeRange = `${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}`;
  const venue = `${event.venue ?? ""}${event.city ? ` (${event.city})` : ""}`.trim();

  const positions = await db.select().from(schema.positions).where(eq(schema.positions.eventId, event.id));
  for (const p of positions) {
    const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, p.id));
    for (const inv of invites) {
      if (inv.status !== "pending" && inv.status !== "accepted") continue;
      if (!inv.sentAt) continue; // never actually notified in the first place - skip
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
      const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
      if (!u) continue;

      const textBody = [
        `Hi ${profile?.firstName ?? ""},`, ``,
        `⚠ This shift has been CANCELLED. You no longer need to attend.`, ``,
        `Role:        ${p.role}`,
        `Date:        ${prettyDate}`,
        `Approx time: ${timeRange}`,
        venue ? `Venue:       ${venue}` : "",
        `Client:      ${event.clientName}`, ``,
        `Sorry for the short notice.`, ``,
        `– ${companyName}`,
      ].filter(Boolean).join("\n");

      const htmlBody = shellWrap([
        greeting(profile?.firstName, "The shift you were confirmed for has been cancelled."),
        banner("⚠  Shift cancelled - you no longer need to attend.", "warning"),
        kvTable([
          kvRow("Role", p.role),
          kvRow("Date", prettyDate),
          kvRow("Approx time", timeRange),
          venue ? kvRow("Venue", venue) : "",
          kvRow("Client", event.clientName),
        ]),
        paragraph("Sorry for the short notice.", { muted: true }),
        signoff(companyName),
      ].join("\n"));

      await sendEmail({
        to: u.email,
        subject: `CANCELLED: ${event.clientName} on ${prettyDate}`,
        body: textBody,
        html: htmlBody,
        companyId,
        userId: inv.userId,
        relatedInvitationId: inv.id,
        notificationKey: "eventCancelled",
      });
    }
  }
}

/**
 * Notify invited+accepted staff that event-level details changed (date/time/venue/notes).
 */
export async function notifyEventDetailsChanged(
  event: EventRow,
  companyId: string,
  changeSummary: string,
  // True when the change involved date, check-in time, or end time.
  // These are the kinds of changes that could blow up a staffer's day
  // (childcare, commute, other commitments), so the email flips tone:
  // URGENT subject + prominent red banner instead of the quiet "Update".
  isBigChange: boolean = false,
) {
  const companyName = await getCompanyName(companyId);
  const prettyDate = formatDate(event.date);
  const timeRange = `${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}`;
  const venue = `${event.venue ?? ""}${event.city ? ` (${event.city})` : ""}`.trim();

  const subjectPrefix = isBigChange ? "⚠ IMPORTANT — " : "Update: ";
  const leadSentence = isBigChange
    ? "The date or time of your shift changed. Double-check it still works for you."
    : "The shift you were confirmed for has been updated.";
  const bannerHtml = isBigChange
    ? `<div style="margin:0 0 20px;padding:14px 18px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;color:#991b1b;font-weight:600;">
         ⚠ IMPORTANT: date or time changed. Please verify you can still make it.
       </div>`
    : "";

  const positions = await db.select().from(schema.positions).where(eq(schema.positions.eventId, event.id));
  for (const p of positions) {
    const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, p.id));
    for (const inv of invites) {
      if (inv.status !== "pending" && inv.status !== "accepted") continue;
      if (!inv.sentAt) continue;
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
      const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
      if (!u) continue;

      const textBody = [
        `Hi ${profile?.firstName ?? ""},`, ``,
        isBigChange ? `⚠ IMPORTANT — the date or time of this shift CHANGED. Double-check it still works for you:` : `The shift you were invited to has been updated:`, ``,
        changeSummary, ``,
        `Current details:`,
        `Role:        ${p.role}`,
        `Date:        ${prettyDate}`,
        `Approx time: ${timeRange}`,
        venue ? `Venue:       ${venue}` : "",
        `Client:      ${event.clientName}`, ``,
        `– ${companyName}`,
      ].filter(Boolean).join("\n");

      const changesHtml = `<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;margin:0 0 20px;font-family:inherit;font-size:14px;line-height:1.5;white-space:pre-wrap;color:#111;">${escapeChangeSummary(changeSummary)}</pre>`;

      const htmlBody = shellWrap([
        greeting(profile?.firstName, leadSentence),
        bannerHtml,
        `<p style="margin:0 0 8px;font-weight:600;">What changed</p>`,
        changesHtml,
        `<p style="margin:0 0 8px;font-weight:600;">Current details</p>`,
        kvTable([
          kvRow("Role", p.role),
          kvRow("Date", prettyDate),
          kvRow("Approx time", timeRange),
          venue ? kvRow("Venue", venue) : "",
          kvRow("Client", event.clientName),
        ]),
        signoff(companyName),
      ].join("\n"));

      await sendEmail({
        to: u.email,
        subject: `${subjectPrefix}${event.clientName} on ${prettyDate}`,
        body: textBody,
        html: htmlBody,
        companyId,
        userId: inv.userId,
        relatedInvitationId: inv.id,
        notificationKey: "eventChanged",
      });
    }
  }
}

/**
 * Notify invited/accepted staff on a specific position that THEIR SHIFT changed -
 * pay rate, van driver designation, or (for the current van driver) van driving
 * instructions. Kept separate from notifyEventDetailsChanged because these
 * changes only affect the invitees on one position, not everyone on the event.
 */
export async function notifyPositionChanged(
  event: EventRow,
  position: typeof schema.positions.$inferSelect,
  changes: string[],
  newVanInstructions: string | null,
  companyId: string,
) {
  if (changes.length === 0 && !newVanInstructions) return;
  const companyName = await getCompanyName(companyId);
  const prettyDate = formatDate(event.date);
  const timeRange = `${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}`;
  const venue = `${event.venue ?? ""}${event.city ? ` (${event.city})` : ""}`.trim();

  const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, position.id));
  for (const inv of invites) {
    if (inv.status !== "pending" && inv.status !== "accepted") continue;
    if (!inv.sentAt) continue;
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
    const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
    if (!u) continue;

    const textBody = [
      `Hi ${profile?.firstName ?? ""},`, ``,
      `The shift you were invited to has been updated:`, ``,
      ...changes.map((c) => `• ${c}`), ``,
      newVanInstructions ? `Van driving instructions:\n${newVanInstructions}\n` : "",
      `Current details:`,
      `Role:        ${position.role}`,
      `Date:        ${prettyDate}`,
      `Approx time: ${timeRange}`,
      venue ? `Venue:       ${venue}` : "",
      `Client:      ${event.clientName}`, ``,
      `– ${companyName}`,
    ].filter(Boolean).join("\n");

    const changesHtml = `<ul style="margin:0 0 20px;padding-left:20px;color:#111;">${changes
      .map((c) => `<li style="margin:0 0 6px;">${escapeChangeSummary(c)}</li>`)
      .join("")}</ul>`;

    const vanInstructionsHtml = newVanInstructions
      ? `<p style="margin:0 0 6px;font-weight:600;">Van driving instructions</p>
         <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;margin:0 0 20px;font-family:inherit;font-size:14px;line-height:1.5;white-space:pre-wrap;color:#111;">${escapeChangeSummary(newVanInstructions)}</pre>`
      : "";

    const htmlBody = shellWrap([
      greeting(profile?.firstName, "Your shift details have been updated."),
      `<p style="margin:0 0 8px;font-weight:600;">What changed</p>`,
      changesHtml,
      vanInstructionsHtml,
      `<p style="margin:0 0 8px;font-weight:600;">Current details</p>`,
      kvTable([
        kvRow("Role", position.role),
        kvRow("Date", prettyDate),
        kvRow("Approx time", timeRange),
        venue ? kvRow("Venue", venue) : "",
        kvRow("Client", event.clientName),
      ]),
      signoff(companyName),
    ].join("\n"));

    await sendEmail({
      to: u.email,
      subject: `Shift updated: ${event.clientName} on ${prettyDate}`,
      body: textBody,
      html: htmlBody,
      companyId,
      userId: inv.userId,
      relatedInvitationId: inv.id,
      notificationKey: "eventChanged",
    });
  }
}

/**
 * Describe a rate pair as a one-liner for a change email. Null-safe,
 * handles the "standard" (use onboarded rate) mode too.
 */
function describeRate(amount: number | null, mode: string | null): string {
  if (mode === "standard" || mode == null) return "Standard (your onboarded rate)";
  if (mode === "flat") return `$${(amount ?? 0).toFixed(2)} flat`;
  if (mode === "hourly") return `$${(amount ?? 0).toFixed(2)}/hr`;
  return `$${(amount ?? 0).toFixed(2)}`;
}

/**
 * Notify a single staffer that something about their pay on an accepted
 * shift changed. The notes array is a list of "<label>: <before> → <after>"
 * strings so we can bundle a bunch of changes in one email (rate +
 * travel at the same time, for example).
 */
export async function notifyPayChanged(
  userId: string,
  event: EventRow,
  position: typeof schema.positions.$inferSelect,
  notes: string[],
  companyId: string,
): Promise<void> {
  if (notes.length === 0) return;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return;
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId));
  const [inv] = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.userId, userId));
  const companyName = await getCompanyName(companyId);
  const prettyDate = formatDate(event.date);
  const venue = `${event.venue ?? ""}${event.city ? ` (${event.city})` : ""}`.trim();

  const textBody = [
    `Hi ${profile?.firstName ?? "there"},`, ``,
    `Your pay on an accepted shift was updated:`, ``,
    ...notes.map((n) => `• ${n}`), ``,
    `Shift details:`,
    `Role:   ${position.role}`,
    `Date:   ${prettyDate}`,
    venue ? `Venue:  ${venue}` : "",
    `Client: ${event.clientName}`, ``,
    `If this doesn't look right, reach out to your manager at ${companyName} before the shift.`, ``,
    `– ${companyName}`,
  ].filter(Boolean).join("\n");

  const notesHtml = `<ul style="margin:0 0 20px;padding-left:20px;color:#111;">${notes
    .map((n) => `<li style="margin:0 0 6px;">${n}</li>`)
    .join("")}</ul>`;

  const htmlBody = shellWrap([
    banner("Your pay on a confirmed shift changed", "info"),
    greeting(profile?.firstName, `Your manager at ${companyName} updated the pay on a shift you've already accepted.`),
    `<p style="margin:0 0 8px;font-weight:600;">What changed</p>`,
    notesHtml,
    `<p style="margin:0 0 8px;font-weight:600;">Shift details</p>`,
    kvTable([
      kvRow("Role", position.role),
      kvRow("Date", prettyDate),
      venue ? kvRow("Venue", venue) : "",
      kvRow("Client", event.clientName),
    ]),
    paragraph(`If this doesn't look right, reach out to your manager at ${companyName} before the shift.`, { muted: true }),
    signoff(companyName),
  ].join("\n"));

  await sendEmail({
    to: u.email,
    subject: `Shift pay updated: ${event.clientName} on ${prettyDate}`,
    body: textBody,
    html: htmlBody,
    companyId,
    userId,
    relatedInvitationId: inv?.id,
    notificationKey: "payChanged",
  });
}

export { describeRate };

/**
 * Notify staff invited/accepted on a specific position that the position was removed from the event.
 */
export async function notifyPositionRemoved(
  event: EventRow,
  removedRole: string,
  invites: Array<typeof schema.invitations.$inferSelect>,
  companyId: string,
) {
  const companyName = await getCompanyName(companyId);
  const prettyDate = formatDate(event.date);

  for (const inv of invites) {
    if (inv.status !== "pending" && inv.status !== "accepted") continue;
    if (!inv.sentAt) continue;
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
    const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
    if (!u) continue;

    const textBody = [
      `Hi ${profile?.firstName ?? ""},`, ``,
      `The ${removedRole} position you were invited to has been removed from this event.`,
      `You no longer need to attend.`, ``,
      `Client: ${event.clientName}`,
      `Date:   ${prettyDate}`, ``,
      `– ${companyName}`,
    ].join("\n");

    const htmlBody = shellWrap([
      greeting(profile?.firstName, `The ${removedRole} position you were invited to has been removed.`),
      banner("⚠  Position removed - you no longer need to attend.", "warning"),
      kvTable([
        kvRow("Role", removedRole),
        kvRow("Date", prettyDate),
        kvRow("Client", event.clientName),
      ]),
      signoff(companyName),
    ].join("\n"));

    await sendEmail({
      to: u.email,
      subject: `Position removed: ${event.clientName} on ${prettyDate}`,
      body: textBody,
      html: htmlBody,
      companyId,
      userId: inv.userId,
      relatedInvitationId: inv.id,
      notificationKey: "eventChanged",
    });
  }
}

/**
 * Notify a staffer that the position they were a pending backup for just
 * got filled by someone else. No action needed — this is a courtesy so
 * they're not left wondering whether they're on the shift.
 *
 * `invitationIds` is the list from pendingToRelease() — status should
 * already have been flipped to "filled" by the caller before this fires
 * so the recipient isn't counted as "still invited" anywhere else.
 */
export async function notifyPositionFilled(
  event: EventRow,
  role: string,
  invitationIds: string[],
  companyId: string,
) {
  if (invitationIds.length === 0) return;
  const companyName = await getCompanyName(companyId);
  const prettyDate = formatDate(event.date);

  for (const invId of invitationIds) {
    const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invId));
    if (!inv) continue;
    // Only send if we had actually emailed them originally — otherwise
    // we're spamming someone who never knew they were on standby.
    if (!inv.sentAt) continue;
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
    const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
    if (!u) continue;

    const textBody = [
      `Hi ${profile?.firstName ?? ""},`, ``,
      `Quick heads-up — the ${role} position for ${event.clientName} on ${prettyDate} is now fully staffed.`,
      `You're free from this shift and can be booked for other events that day.`, ``,
      `No action needed on your end. Thanks for being flexible!`, ``,
      `– ${companyName}`,
    ].join("\n");

    const htmlBody = shellWrap([
      greeting(profile?.firstName, `Heads-up — the ${role} position for ${event.clientName} on ${prettyDate} is now fully staffed.`),
      banner("✓ No action needed — this slot was filled by someone else.", "info"),
      kvTable([
        kvRow("Role", role),
        kvRow("Date", prettyDate),
        kvRow("Client", event.clientName),
      ]),
      paragraph("You're free from this shift and can be booked for other events that day. Thanks for being flexible!", { muted: true }),
      signoff(companyName),
    ].join("\n"));

    await sendEmail({
      to: u.email,
      subject: `Position filled: ${event.clientName} on ${prettyDate}`,
      body: textBody,
      html: htmlBody,
      companyId,
      userId: inv.userId,
      relatedInvitationId: inv.id,
      notificationKey: "eventChanged",
    });
  }
}

/** Minimal HTML-escape for the change-summary block (preserves newlines). */
function escapeChangeSummary(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
