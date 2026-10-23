/**
 * Hourly shift-reminder dispatch loop. Iterates every live accepted
 * invitation for events happening today or tomorrow, resolves the
 * staffer's timezone + chosen reminder hour, and fires the day-before
 * / morning-of email when shouldSendReminderNow() approves.
 *
 * Idempotent: the invitation row carries reminderDayBeforeSentAt and
 * reminderMorningOfSentAt timestamps, which get stamped on send so the
 * next tick skips the already-sent ones.
 */

import { db, schema } from "@/db/client";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, greeting, paragraph, kvRow, kvTable, signoff } from "@/lib/email-html";
import { formatDate, formatTime } from "@/lib/format";
import { shouldSendReminderNow, addDays, localDateString } from "@/lib/shift-reminders";

const DEFAULT_TZ = "America/Los_Angeles";

export async function runShiftReminders(now: Date = new Date()): Promise<{
  checked: number;
  sentDayBefore: number;
  sentMorningOf: number;
  skipped: number;
}> {
  // Shifts we care about this tick are today or tomorrow in *some*
  // reasonable timezone. We don't know each staffer's tz up front, so
  // we grab a two-day window around UTC-now and let the per-staffer
  // check narrow it. Cheap: a scheduler app has at most a few hundred
  // shifts in a two-day window.
  const utcToday = localDateString(now, "UTC");
  const dates = [addDays(utcToday, -1), utcToday, addDays(utcToday, 1), addDays(utcToday, 2)];

  const events = await db.select().from(schema.events).where(inArray(schema.events.date, dates));
  if (events.length === 0) {
    return { checked: 0, sentDayBefore: 0, sentMorningOf: 0, skipped: 0 };
  }
  const eventIds = events.map((e) => e.id);
  const positionsList = await db
    .select()
    .from(schema.positions)
    .where(inArray(schema.positions.eventId, eventIds));
  if (positionsList.length === 0) {
    return { checked: 0, sentDayBefore: 0, sentMorningOf: 0, skipped: 0 };
  }
  const positionIds = positionsList.map((p) => p.id);

  // Pull live accepted invitations only (we don't remind for pending or
  // rejected). isNull on BOTH stamp columns would skip rows that still
  // need the morning-of after day-before went out, so instead we filter
  // in-memory below.
  const invitations = await db
    .select()
    .from(schema.invitations)
    .where(
      and(
        inArray(schema.invitations.positionId, positionIds),
        eq(schema.invitations.status, "accepted"),
        isNull(schema.invitations.cancelledAt),
        or(
          isNull(schema.invitations.reminderDayBeforeSentAt),
          isNull(schema.invitations.reminderMorningOfSentAt),
        ),
      ),
    );
  if (invitations.length === 0) {
    return { checked: 0, sentDayBefore: 0, sentMorningOf: 0, skipped: 0 };
  }

  const userIds = Array.from(new Set(invitations.map((i) => i.userId)));
  const users = await db.select().from(schema.users).where(inArray(schema.users.id, userIds));
  const profiles = await db
    .select()
    .from(schema.staffProfiles)
    .where(inArray(schema.staffProfiles.userId, userIds));
  const posById = new Map(positionsList.map((p) => [p.id, p]));
  const evtById = new Map(events.map((e) => [e.id, e]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const profileByUserId = new Map(profiles.map((p) => [p.userId, p]));

  let checked = 0;
  let sentDayBefore = 0;
  let sentMorningOf = 0;
  let skipped = 0;

  for (const inv of invitations) {
    const pos = posById.get(inv.positionId);
    if (!pos) continue;
    const evt = evtById.get(pos.eventId);
    if (!evt) continue;
    if (evt.cancelledAt) continue;
    const user = userById.get(inv.userId);
    const profile = profileByUserId.get(inv.userId);
    if (!user || !profile) continue;
    checked++;

    const tz = profile.timezone || DEFAULT_TZ;

    // Day-before
    if (!inv.reminderDayBeforeSentAt && profile.reminderDayBeforeHour != null) {
      const fire = shouldSendReminderNow({
        kind: "dayBefore",
        shiftDate: evt.date,
        shiftCheckInTime: evt.checkInTime,
        chosenHour: profile.reminderDayBeforeHour,
        staffTz: tz,
        alreadySent: false,
        now,
      });
      if (fire) {
        await sendReminderEmail("dayBefore", user, profile, evt, pos, inv.id);
        await db
          .update(schema.invitations)
          .set({ reminderDayBeforeSentAt: new Date() })
          .where(eq(schema.invitations.id, inv.id));
        sentDayBefore++;
        continue; // one reminder per invite per tick is enough
      }
    }

    // Morning-of
    if (!inv.reminderMorningOfSentAt && profile.reminderMorningOfHour != null) {
      const fire = shouldSendReminderNow({
        kind: "morningOf",
        shiftDate: evt.date,
        shiftCheckInTime: evt.checkInTime,
        chosenHour: profile.reminderMorningOfHour,
        staffTz: tz,
        alreadySent: false,
        now,
      });
      if (fire) {
        await sendReminderEmail("morningOf", user, profile, evt, pos, inv.id);
        await db
          .update(schema.invitations)
          .set({ reminderMorningOfSentAt: new Date() })
          .where(eq(schema.invitations.id, inv.id));
        sentMorningOf++;
        continue;
      }
    }

    skipped++;
  }

  return { checked, sentDayBefore, sentMorningOf, skipped };
}

async function sendReminderEmail(
  kind: "dayBefore" | "morningOf",
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

  const headline =
    kind === "dayBefore"
      ? `Reminder: you're on shift tomorrow`
      : `Reminder: your shift starts today`;
  const lead =
    kind === "dayBefore"
      ? `Heads up — tomorrow (${prettyDate}) you're on at ${venue || event.clientName}.`
      : `Today's the day. See you at ${venue || event.clientName}.`;

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
    subject: `${headline}: ${event.clientName} on ${prettyDate}`,
    body: textBody,
    html: htmlBody,
    companyId: event.companyId,
    userId: user.id,
    relatedInvitationId: invitationId,
    notificationKey: "shiftReminder",
  });
}
