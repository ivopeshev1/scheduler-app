/**
 * Daily shift-reminders dispatch. Fires once a day (the vercel.json
 * cron is 15:00 UTC = roughly 7-8am PT / 10-11am ET) and emails every
 * confirmed staffer whose shift is TOMORROW. One email per invite,
 * idempotent via the reminderDayBeforeSentAt stamp.
 *
 * Simplified from the earlier per-staffer hour-picker design because
 * Vercel's Hobby plan only allows daily cron schedules. If the project
 * ever upgrades to Pro, the hourly variant (per-staffer chosen hour +
 * local-timezone matching) can be restored from git history - the
 * schema columns (reminder_day_before_hour, reminder_morning_of_hour)
 * are still in place.
 *
 * Opt-in: a staffer with reminderDayBeforeHour=null has turned the
 * day-before reminder off and is skipped. The hour VALUE is ignored
 * (we fire at the cron's wall-clock hour for everyone); non-null just
 * means "yes, I want it".
 */

import { db, schema } from "@/db/client";
import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, greeting, paragraph, kvRow, kvTable, signoff } from "@/lib/email-html";
import { formatDate, formatTime } from "@/lib/format";

export async function runShiftReminders(now: Date = new Date()): Promise<{
  checked: number;
  sent: number;
  skipped: number;
}> {
  // "Tomorrow" in UTC terms. We don't bother resolving per-staffer
  // timezone here because the cron fires at the same wall-clock
  // moment for the whole app anyway.
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tomorrowIso = `${tomorrow.getUTCFullYear()}-${pad(tomorrow.getUTCMonth() + 1)}-${pad(tomorrow.getUTCDate())}`;

  const events = await db.select().from(schema.events).where(eq(schema.events.date, tomorrowIso));
  if (events.length === 0) return { checked: 0, sent: 0, skipped: 0 };
  const eventIds = events.map((e) => e.id);
  const positionsList = await db
    .select()
    .from(schema.positions)
    .where(inArray(schema.positions.eventId, eventIds));
  if (positionsList.length === 0) return { checked: 0, sent: 0, skipped: 0 };
  const positionIds = positionsList.map((p) => p.id);

  // Accepted, not cancelled, not already-reminded.
  const invitations = await db
    .select()
    .from(schema.invitations)
    .where(
      and(
        inArray(schema.invitations.positionId, positionIds),
        eq(schema.invitations.status, "accepted"),
        isNull(schema.invitations.cancelledAt),
        isNull(schema.invitations.reminderDayBeforeSentAt),
      ),
    );
  if (invitations.length === 0) return { checked: 0, sent: 0, skipped: 0 };

  const userIds = Array.from(new Set(invitations.map((i) => i.userId)));
  const users = await db.select().from(schema.users).where(inArray(schema.users.id, userIds));
  // Filter: the staffer has to be opted into day-before reminders. We
  // check staff_profiles.reminderDayBeforeHour — null = off.
  const profiles = await db
    .select()
    .from(schema.staffProfiles)
    .where(and(inArray(schema.staffProfiles.userId, userIds), isNotNull(schema.staffProfiles.reminderDayBeforeHour)));
  const optedInUserIds = new Set(profiles.map((p) => p.userId));

  const posById = new Map(positionsList.map((p) => [p.id, p]));
  const evtById = new Map(events.map((e) => [e.id, e]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const profileByUserId = new Map(profiles.map((p) => [p.userId, p]));

  let checked = 0;
  let sent = 0;
  let skipped = 0;

  for (const inv of invitations) {
    const pos = posById.get(inv.positionId);
    if (!pos) continue;
    const evt = evtById.get(pos.eventId);
    if (!evt || evt.cancelledAt) continue;
    const user = userById.get(inv.userId);
    if (!user) continue;
    checked++;

    if (!optedInUserIds.has(inv.userId)) {
      skipped++;
      continue;
    }
    const profile = profileByUserId.get(inv.userId);
    if (!profile) {
      skipped++;
      continue;
    }

    await sendReminderEmail(user, profile, evt, pos, inv.id);
    await db
      .update(schema.invitations)
      .set({ reminderDayBeforeSentAt: new Date() })
      .where(eq(schema.invitations.id, inv.id));
    sent++;
  }

  return { checked, sent, skipped };
}

async function sendReminderEmail(
  user: typeof schema.users.$inferSelect,
  profile: typeof schema.staffProfiles.$inferSelect,
  event: typeof schema.events.$inferSelect,
  position: typeof schema.positions.$inferSelect,
  invitationId: string,
): Promise<void> {
  const [company] = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, event.companyId));
  const companyName = company?.name ?? "Scheduler";
  const prettyDate = formatDate(event.date);
  const timeRange = `${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}`;
  const venue = `${event.venue ?? ""}${event.city ? ` (${event.city})` : ""}`.trim();

  const lead = `Heads up — tomorrow (${prettyDate}) you're on at ${venue || event.clientName}.`;

  const textBody = [
    `Hi ${profile?.firstName ?? "there"},`, ``,
    lead, ``,
    `Role:   ${position.role}`,
    `Date:   ${prettyDate}`,
    `Time:   ${timeRange}`,
    venue ? `Venue:  ${venue}` : "",
    `Client: ${event.clientName}`, ``,
    event.staffNotes ? `Notes from your manager:\n${event.staffNotes}\n` : "",
    `– ${companyName}`,
  ].filter(Boolean).join("\n");

  const htmlBody = shellWrap([
    greeting(profile?.firstName, lead),
    `<p style="margin:0 0 8px;font-weight:600;">Shift details</p>`,
    kvTable([
      kvRow("Role", position.role),
      kvRow("Date", prettyDate),
      kvRow("Time", timeRange),
      venue ? kvRow("Venue", venue) : "",
      kvRow("Client", event.clientName),
    ]),
    event.staffNotes
      ? `<p style="margin:16px 0 8px;font-weight:600;">Notes from your manager</p>
         <p style="margin:0 0 20px;white-space:pre-wrap;">${event.staffNotes.replace(/</g, "&lt;")}</p>`
      : "",
    paragraph(`Can't make it? Open the shift in ${companyName} and cancel so the team can find a replacement.`, { muted: true }),
    signoff(companyName),
  ].join("\n"));

  await sendEmail({
    to: user.email,
    subject: `Reminder: you're on shift tomorrow — ${event.clientName} on ${prettyDate}`,
    body: textBody,
    html: htmlBody,
    companyId: event.companyId,
    userId: user.id,
    relatedInvitationId: invitationId,
    notificationKey: "shiftReminder",
  });
}
