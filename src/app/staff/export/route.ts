import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, inArray } from "drizzle-orm";

/**
 * GET /staff/export — returns a JSON file of everything the signed-in
 * staffer's account holds: their profile (minus the photo blob, which
 * is huge and already a data URL they can grab from the UI), their
 * notification + quiet-hours + reminder-time preferences, every
 * invitation they ever got (status, event, pay fields), and the
 * audit trail of notifications we sent them.
 *
 * Privacy escape hatch: lets a staffer see what we have on them without
 * asking the manager. Not a replacement for a formal GDPR / CCPA
 * data request, but handles the 90% case.
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "staff") return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) return new NextResponse("Not found", { status: 404 });
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));

  const roles = await db.select().from(schema.staffRoles).where(eq(schema.staffRoles.userId, session.userId));
  const locationsAssigned = await db
    .select()
    .from(schema.userLocations)
    .where(eq(schema.userLocations.userId, session.userId));
  const invitations = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.userId, session.userId));
  const posIds = Array.from(new Set(invitations.map((i) => i.positionId)));
  const positions = posIds.length
    ? await db.select().from(schema.positions).where(inArray(schema.positions.id, posIds))
    : [];
  const evtIds = Array.from(new Set(positions.map((p) => p.eventId)));
  const events = evtIds.length
    ? await db.select().from(schema.events).where(inArray(schema.events.id, evtIds))
    : [];
  const blocks = await db
    .select()
    .from(schema.availabilityBlocks)
    .where(eq(schema.availabilityBlocks.userId, session.userId));
  const notifications = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, session.userId));

  // Strip the photo data URL from the profile dump — it's up to 500KB
  // of base64, inflates the file a lot, and the staffer can save their
  // own picture from the UI.
  const { photoUrl: _photo, ...profileSansPhoto } = profile ?? ({} as typeof profile);

  const payload = {
    exportedAt: new Date().toISOString(),
    account: {
      userId: user.id,
      email: user.email,
      companyName: company?.name ?? null,
      inviteAcceptedAt: user.inviteAcceptedAt,
      archivedAt: user.archivedAt,
    },
    profile: profileSansPhoto,
    roles: roles.map((r) => ({ role: r.role, rate: r.rate, rateType: r.rateType })),
    locationsAssigned: locationsAssigned.map((l) => l.locationId),
    preferences: {
      notifications: user.notificationPreferences,
      quietHours: {
        start: user.quietHoursStart,
        end: user.quietHoursEnd,
        tz: user.quietHoursTz,
      },
      reminders: {
        dayBeforeHour: profile?.reminderDayBeforeHour ?? null,
        morningOfHour: profile?.reminderMorningOfHour ?? null,
      },
    },
    availabilityBlocks: blocks.map((b) => ({ date: b.date, startTime: b.startTime, endTime: b.endTime, reason: b.reason })),
    shifts: invitations.map((inv) => {
      const pos = positions.find((p) => p.id === inv.positionId);
      const evt = pos ? events.find((e) => e.id === pos.eventId) : null;
      return {
        invitationId: inv.id,
        status: inv.status,
        tier: inv.tier,
        isOnCall: !!inv.isOnCall,
        sentAt: inv.sentAt,
        respondedAt: inv.respondedAt,
        cancelledAt: inv.cancelledAt,
        paidAt: inv.paidAt,
        clockIn: inv.clockIn,
        clockOut: inv.clockOut,
        breakFrom: inv.breakFrom,
        breakTo: inv.breakTo,
        gratuity: inv.gratuity,
        rateOverrideAmount: inv.rateOverrideAmount,
        rateOverrideMode: inv.rateOverrideMode,
        travelRate: inv.travelRate,
        position: pos ? { role: pos.role, baseRate: pos.baseRate, baseRateMode: pos.baseRateMode } : null,
        event: evt ? { date: evt.date, venue: evt.venue, city: evt.city, clientName: evt.clientName, checkInTime: evt.checkInTime, eventStartTime: evt.eventStartTime, endTime: evt.endTime } : null,
      };
    }),
    notificationsLog: notifications.map((n) => ({
      sentAt: n.createdAt,
      channel: n.channel,
      subject: n.subject,
      status: n.status,
    })),
  };

  const body = JSON.stringify(payload, null, 2);
  const filename = `scheduler-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
