import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { summarizePosition } from "@/lib/status";
import { sendEmail, escapeHtml } from "@/lib/notifications";
import { formatTime, formatDate } from "@/lib/format";
import { notifyCancellation } from "@/lib/event-notifications";
import { shellWrap, kvRow, kvTable, greeting, banner, paragraph, signoff } from "@/lib/email-html";
import { StaffPicker, type StaffOption } from "@/components/StaffPicker";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

const ELIGIBILITY: Record<string, string[]> = {
  "Bar Lead":  ["Lead"], "Bar Back":  ["Bar Back"], "Bartender": ["Bartender"],
  "Server":    ["Server"], "Cashier":   ["Cashier"],
};

/**
 * Draft-save invitations for one position.
 * No emails go out here — manager hits the master "Send invitations" button to fire them.
 */
async function saveInvitations(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const positionId = String(formData.get("positionId"));
  const eventId = String(formData.get("eventId"));
  const selections = JSON.parse(String(formData.get("selections") ?? "{}")) as Record<string, number | null>;
  const rawTravelRates = JSON.parse(String(formData.get("travelRates") ?? "{}")) as Record<string, string>;
  // Parse each travel-rate string to a number (or null if blank/invalid)
  const travelRates: Record<string, number | null> = {};
  for (const [uid, raw] of Object.entries(rawTravelRates)) {
    const s = (raw ?? "").toString().trim();
    if (!s) { travelRates[uid] = null; continue; }
    const n = Number(s);
    travelRates[uid] = Number.isFinite(n) ? n : null;
  }

  const [position] = await db.select().from(schema.positions).where(eq(schema.positions.id, positionId));
  if (!position) throw new Error("Position not found");
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, position.eventId));
  if (!event) throw new Error("Event not found");

  const existing = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, positionId));

  // Pull every active invite for this company on the SAME DATE as this event so we can
  // reject any attempt to double-invite the same person to two positions on the same day
  // (either within this event or a different event on the same date).
  const sameDayInvites = await db
    .select({ inv: schema.invitations, pos: schema.positions, ev: schema.events })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .innerJoin(schema.events, eq(schema.positions.eventId, schema.events.id))
    .where(eq(schema.events.companyId, session.companyId));

  function hasSameDayConflictElsewhere(userId: string): boolean {
    return sameDayInvites.some((r) =>
      r.inv.userId === userId &&
      r.ev.date === event.date &&
      r.pos.id !== positionId &&
      (r.inv.status === "pending" || r.inv.status === "accepted")
    );
  }

  for (const [userId, tierRaw] of Object.entries(selections)) {
    const tier = tierRaw === null || tierRaw === undefined ? null : Number(tierRaw);
    const current = existing.find((e) => e.userId === userId);

    if (tier === null) {
      // Deselected. Cases:
      //   - Unsent draft (pending, no sentAt): silent delete, nobody was notified yet.
      //   - Sent pending (pending, sentAt): staff got an invite email → send "shift removed".
      //   - Accepted: free their slot + send "shift removed" email.
      // Rejected/expired: leave the record as-is (it's already terminal; removing it
      // would lose the audit trail).
      if (current && (current.status === "pending" || current.status === "accepted")) {
        const wasEverNotified = !!current.sentAt;

        // Free the slot if they had accepted (removes them from the confirmed staffing)
        if (current.slotId) {
          await db.update(schema.slots)
            .set({ acceptedUserId: null, acceptedAt: null })
            .where(eq(schema.slots.id, current.slotId));
        }

        if (wasEverNotified) {
          const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
          const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId));
          const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
          const companyName = company?.name ?? "Scheduler";
          const prettyDate = formatDate(event.date);
          if (u) {
            const textBody = [
              `Hi ${profile?.firstName ?? ""},`, ``,
              `Your ${position.role} slot for this shift has been removed.`,
              `You no longer need to attend.`, ``,
              `Role:   ${position.role}`,
              `Date:   ${prettyDate}`,
              `Client: ${event.clientName}`, ``,
              `– ${companyName}`,
            ].join("\n");
            const htmlBody = shellWrap([
              greeting(profile?.firstName, `Your ${position.role} slot for this shift has been removed.`),
              banner("⚠  Shift removed — you no longer need to attend.", "warning"),
              kvTable([
                kvRow("Role", position.role),
                kvRow("Date", prettyDate),
                kvRow("Client", event.clientName),
              ]),
              paragraph("If you have questions, reach out to your manager.", { muted: true }),
              signoff(companyName),
            ].join("\n"));
            await sendEmail({
              to: u.email,
              subject: `Shift removed: ${event.clientName} on ${prettyDate}`,
              body: textBody,
              html: htmlBody,
              companyId: session.companyId,
              userId,
            });
          }
        }
        await db.delete(schema.invitations).where(eq(schema.invitations.id, current.id));
      }
      continue;
    }

    if (current) {
      // Travel rate can be updated at any time (it's not something the staff sees
      // until the invite email fires, and even sent-priority invites can have their
      // travel comp adjusted up/down by the manager).
      const newTravel = userId in travelRates ? travelRates[userId] : current.travelRate ?? null;
      if (current.status === "pending" && !current.sentAt) {
        // Can still change tier on unsent drafts
        await db.update(schema.invitations)
          .set({ tier, travelRate: newTravel })
          .where(eq(schema.invitations.id, current.id));
      } else if (newTravel !== (current.travelRate ?? null)) {
        // Tier is locked (email sent) but travel can still be tweaked
        await db.update(schema.invitations)
          .set({ travelRate: newTravel })
          .where(eq(schema.invitations.id, current.id));
      }
    } else {
      // Guard: skip inserting if the same staff is already active on a different position on this date
      if (hasSameDayConflictElsewhere(userId)) continue;
      await db.insert(schema.invitations).values({
        id: nanoid(),
        positionId,
        userId,
        tier,
        status: "pending",
        sentAt: null,
        token: nanoid(32),
        travelRate: travelRates[userId] ?? null,
      });
    }
  }

  revalidatePath(`/manager/event/${eventId}`);
}

/**
 * Fire all pending PRIORITY (tier 0) invitations that haven't been sent yet.
 * Backup tiers stay unsent until cascaded.
 */
async function cancelEventAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const eventId = String(formData.get("eventId"));
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!event || event.companyId !== session.companyId) throw new Error("Not found");
  if (event.cancelledAt) {
    // already cancelled; no-op
    redirect(`/manager/event/${eventId}`);
  }

  await db.update(schema.events).set({ cancelledAt: new Date() }).where(eq(schema.events.id, eventId));

  // Re-read so the notification includes the cancelled marker context
  const [updated] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (updated) {
    await notifyCancellation(updated, session.companyId);
  }

  revalidatePath(`/manager/event/${eventId}`);
  redirect(`/manager/event/${eventId}`);
}

async function uncancelEventAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const eventId = String(formData.get("eventId"));
  await db.update(schema.events).set({ cancelledAt: null }).where(eq(schema.events.id, eventId));
  revalidatePath(`/manager/event/${eventId}`);
  redirect(`/manager/event/${eventId}`);
}

async function sendPendingInvitations(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const eventId = String(formData.get("eventId"));
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!event || event.companyId !== session.companyId) throw new Error("Not found");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const companyName = company?.name ?? "Scheduler";

  const positionsForEvent = await db.select().from(schema.positions).where(eq(schema.positions.eventId, eventId));
  const byPosition = new Map(positionsForEvent.map((p) => [p.id, p]));
  const prettyDate = formatDate(event.date);

  let sentCount = 0;
  for (const p of positionsForEvent) {
    const pending = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.positionId, p.id));
    const toSend = pending.filter((i) => i.status === "pending" && i.tier === 0 && !i.sentAt);

    for (const inv of toSend) {
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
      const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
      if (!u) continue;
      const position = byPosition.get(inv.positionId)!;
      // Van-driving language only goes to the staff member whose position is flagged as the driver.
      const vanLine = position.requiresVanDriving ? `This shift requires driving the van.` : "";
      const vanInstructions = position.requiresVanDriving && event.vanDrivingInstructions
        ? `Van driving instructions: ${event.vanDrivingInstructions}`
        : "";

      const venue = `${event.venue ?? ""}${event.city ? ` (${event.city})` : ""}`.trim();
      const timeRange = `${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}`;

      // Base-rate display depends on the position's rate mode:
      //   "standard" — show the staff's onboarded rate (varies per invitee)
      //   "flat"     — fixed $ for the whole shift
      //   "hourly"   — $ per hour, overriding the staff's onboarded rate
      const baseRateDisplay = (() => {
        if (position.baseRateMode === "standard") {
          const rate = profile?.defaultRate;
          const type = profile?.defaultRateType;
          if (rate == null) return "Your standard rate (to be confirmed with manager)";
          if (type === "hourly") return `Your standard rate ($${rate}/hr, as on file)`;
          if (type === "flat") return `Your standard rate ($${rate} flat, as on file)`;
          if (type === "both") return `Your standard rate ($${rate} — hourly or flat, per event, as on file)`;
          return `Your standard rate ($${rate}, as on file)`;
        }
        if (position.baseRateMode === "hourly") {
          return `$${position.baseRate ?? 0}/hr (for this shift)`;
        }
        return `$${position.baseRate ?? 0}`;
      })();
      const vanAmount = position.requiresVanDriving ? (position.vanDrivingRate ?? 0) : 0;
      // Travel comp is per-invitee now (each person's travel varies by origin)
      const travel = inv.travelRate ?? 0;

      // Plain-text version (fallback for clients that strip HTML).
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
        ...compLinesText,
        ``,
        vanLine,
        vanInstructions,
        event.staffNotes ? `Notes: ${event.staffNotes}` : "",
        ``,
        `Accept or reject this shift at your staff dashboard.`, ``,
        `– ${companyName}`,
      ].filter(Boolean).join("\n");

      // HTML version — rendered by most clients. Uses inline styles (Gmail strips <style>).
      const row = (label: string, value: string, bold = false) =>
        `<tr>` +
        `<td style="padding:4px 16px 4px 0;color:#555;white-space:nowrap;${bold ? "font-weight:600;color:#111;" : ""}">${label}</td>` +
        `<td style="padding:4px 0;${bold ? "font-weight:600;" : ""}">${value}</td>` +
        `</tr>`;

      const htmlBody = `
<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;font-size:15px;max-width:560px;margin:0 auto;padding:24px;">
  <p style="margin:0 0 12px;">Hi ${escapeHtml(profile?.firstName ?? "")},</p>
  <p style="margin:0 0 20px;">You're invited to work the following shift:</p>

  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">
    ${row("Role", escapeHtml(position.role))}
    ${event.eventType ? row("Event type", escapeHtml(event.eventType)) : ""}
    ${row("Date", escapeHtml(prettyDate))}
    ${row("Approx time", escapeHtml(timeRange))}
    ${row("Venue", escapeHtml(venue))}
    ${row("Client", escapeHtml(event.clientName))}
  </table>

  <p style="margin:0 0 8px;font-weight:600;">Compensation</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">
    ${row("Base rate", escapeHtml(baseRateDisplay))}
    ${position.requiresVanDriving ? row("Van driving", `$${vanAmount}`) : ""}
    ${travel > 0 ? row("Travel comp", `$${travel}`) : ""}
  </table>

  ${vanLine ? `<p style="margin:0 0 12px;">${escapeHtml(vanLine)}</p>` : ""}
  ${vanInstructions ? `<p style="margin:0 0 12px;color:#555;">${escapeHtml(vanInstructions)}</p>` : ""}
  ${event.staffNotes ? `<p style="margin:0 0 12px;"><strong>Notes:</strong> ${escapeHtml(event.staffNotes)}</p>` : ""}

  <p style="margin:24px 0 0;">Accept or reject this shift at your staff dashboard.</p>
  <p style="margin:24px 0 0;color:#555;">– ${escapeHtml(companyName)}</p>
</body></html>`.trim();

      await sendEmail({
        to: u.email,
        subject: `${companyName} invite to a shift — ${prettyDate}`,
        body: textBody,
        html: htmlBody,
        companyId: session.companyId,
        userId: inv.userId,
        relatedInvitationId: inv.id,
      });
      await db.update(schema.invitations).set({ sentAt: new Date() }).where(eq(schema.invitations.id, inv.id));
      sentCount += 1;
    }
  }

  revalidatePath(`/manager/event/${eventId}`);
}

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, params.id));
  if (!event || event.companyId !== session.companyId) notFound();

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));

  const positionsList = await db.select().from(schema.positions).where(eq(schema.positions.eventId, event.id));
  positionsList.sort((a, b) => a.sortOrder - b.sortOrder);

  const allStaff = await db.select({ user: schema.users, profile: schema.staffProfiles })
    .from(schema.users)
    .innerJoin(schema.staffProfiles, eq(schema.users.id, schema.staffProfiles.userId))
    .where(eq(schema.users.companyId, session.companyId));
  const staffOnly = allStaff.filter((r) => r.user.role === "staff");

  const invitesByPosition: Record<string, typeof schema.invitations.$inferSelect[]> = {};
  for (const p of positionsList) {
    invitesByPosition[p.id] = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, p.id));
  }

  // Find every active invitation company-wide, so we can mark staff as "busy"
  // when they're invited/accepted for another position (any event).
  const companyInvites = await db
    .select({
      invitation: schema.invitations,
      position: schema.positions,
      event: schema.events,
    })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .innerJoin(schema.events, eq(schema.positions.eventId, schema.events.id))
    .where(eq(schema.events.companyId, session.companyId));

  // Build a map: userId -> busy record for THIS event's date only.
  // A staff member is "busy" (unselectable) on this event's date if they have a
  // pending/accepted invite to a DIFFERENT position (same event or different event)
  // on the same day. Conflicts on OTHER days don't affect selectability here.
  const busyMap = new Map<string, { eventDate: string; clientName: string; role: string; positionId: string }>();
  for (const row of companyInvites) {
    const inv = row.invitation;
    if (inv.status !== "pending" && inv.status !== "accepted") continue;
    if (row.event.date !== event.date) continue; // Only same-date conflicts matter
    const existing = busyMap.get(inv.userId);
    if (!existing) {
      busyMap.set(inv.userId, {
        eventDate: row.event.date,
        clientName: row.event.clientName,
        role: row.position.role,
        positionId: row.position.id,
      });
    }
  }

  function buildStaffOptions(positionRole: string, positionId: string): StaffOption[] {
    // Show ALL staff. If someone is invited/accepted elsewhere (different position,
    // any event), mark them busyWith so they show but aren't selectable here.
    const invites = invitesByPosition[positionId] ?? [];
    return staffOnly.map((r) => {
      const inv = invites.find((i) => i.userId === r.user.id);
      const busy = busyMap.get(r.user.id);
      // Only treat as "busy" if their conflict is with a DIFFERENT position than this one
      const busyWith =
        busy && busy.positionId !== positionId
          ? { eventDate: busy.eventDate, clientName: busy.clientName, role: busy.role }
          : null;
      return {
        userId: r.user.id,
        firstName: r.profile.firstName,
        lastName: r.profile.lastName,
        city: r.profile.city,
        position: r.profile.position,
        defaultRate: r.profile.defaultRate,
        defaultRateType: r.profile.defaultRateType,
        currentTier: inv ? inv.tier : null,
        currentStatus: inv ? inv.status : null,
        currentTravelRate: inv ? inv.travelRate ?? null : null,
        busyWith,
      };
    });
  }

  const statuses = await Promise.all(positionsList.map((p) => summarizePosition(p.id)));

  // Count draft priority invites waiting to be sent
  let pendingPrioritySends = 0;
  let pendingBackupDrafts = 0;
  let alreadySent = 0;
  for (const invs of Object.values(invitesByPosition)) {
    for (const inv of invs) {
      if (inv.status === "pending" && !inv.sentAt && inv.tier === 0) pendingPrioritySends += 1;
      else if (inv.status === "pending" && !inv.sentAt && inv.tier > 0) pendingBackupDrafts += 1;
      else if (inv.sentAt) alreadySent += 1;
    }
  }

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>

        {event.cancelledAt && (
          <div className="mt-4 p-3 border-2 border-red-500 bg-red-50 rounded-lg flex items-center justify-between">
            <div className="text-red-700 font-semibold">⚠ EVENT CANCELLED</div>
            <form action={uncancelEventAction}>
              <input type="hidden" name="eventId" value={event.id} />
              <button type="submit" className="btn btn-secondary text-sm">Un-cancel</button>
            </form>
          </div>
        )}

        <div className="mt-4 flex items-start justify-between gap-4">
          <h1 className={`text-3xl font-semibold ${event.cancelledAt ? "line-through text-gray-400" : ""}`}>{event.clientName}</h1>
          {!event.cancelledAt && (
            <div className="flex gap-2">
              <Link href={`/manager/event/${event.id}/edit`} className="btn btn-secondary">Modify</Link>
              <form action={cancelEventAction}>
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit" className="btn btn-secondary text-red-600 hover:bg-red-50">Cancel event</button>
              </form>
            </div>
          )}
        </div>
        <div className="mt-2">
          <div className="text-gray-600 mt-1">
            {event.eventType ?? "—"}
            {event.venue ? ` · ${event.venue}` : ""}
            {event.city ? `, ${event.city}` : ""}
          </div>
          <div className="text-gray-600">
            {event.date} · {formatTime(event.checkInTime)} to {formatTime(event.endTime)}
            {event.guestCount ? ` · ${event.guestCount} guests` : ""}
            {event.numBars ? ` · ${event.numBars} bars` : ""}
            {event.planner ? ` · Planner: ${event.planner}` : ""}
          </div>
        </div>

        <section className="mt-8">
          <h2 className="font-semibold mb-3">Staffing roster</h2>
          <table className="w-full border-collapse">
            <thead className="text-xs text-gray-500 uppercase">
              <tr className="border-b">
                <th className="text-left py-2 w-12">#</th>
                <th className="text-left">Position</th>
                <th className="text-left">Staff / Status</th>
                <th className="text-left">Rate</th>
                <th className="text-left">Invite staff</th>
              </tr>
            </thead>
            <tbody>
              {positionsList.map((p, i) => {
                const s = statuses[i];
                const baseLabel =
                  p.baseRateMode === "standard" ? "Standard rate"
                  : p.baseRateMode === "hourly" ? `$${p.baseRate ?? 0}/hr`
                  : `$${p.baseRate ?? 0}`;
                const staffOptions = buildStaffOptions(p.role, p.id);
                return (
                  <tr key={p.id} className="border-b align-top">
                    <td className="py-3">{p.needed}</td>
                    <td className="py-3 font-medium">{p.role}</td>
                    <td className={`py-3 ${s.state === "pending" ? "status-pending" : "status-confirmed"}`}>{s.label}</td>
                    <td className="py-3 text-sm">
                      <div>{baseLabel}</div>
                      {p.requiresVanDriving && (<div className="text-xs text-gray-500">+ van ${p.vanDrivingRate}</div>)}
                      <div className="text-xs text-gray-400">+ travel (per invitee)</div>
                    </td>
                    <td className="py-3">
                      <StaffPicker positionId={p.id} eventId={event.id} role={p.role} needed={p.needed} mode={p.mode} staff={staffOptions} onSave={saveInvitations} />
                    </td>
                  </tr>
                );
              })}
              {positionsList.length === 0 && (<tr><td colSpan={5} className="py-6 text-center text-gray-400">No positions yet.</td></tr>)}
            </tbody>
          </table>
        </section>

        {/* Master send-invites bar */}
        <section className="mt-6 border rounded-lg bg-gray-50 px-4 py-4 flex items-center justify-between gap-4">
          <div className="text-sm">
            {pendingPrioritySends > 0 ? (
              <>
                <strong>{pendingPrioritySends}</strong> priority invite{pendingPrioritySends > 1 ? "s" : ""} ready to send.
                {pendingBackupDrafts > 0 && <> {pendingBackupDrafts} backup draft{pendingBackupDrafts > 1 ? "s" : ""} saved (silent until needed).</>}
                {alreadySent > 0 && <> {alreadySent} already sent.</>}
              </>
            ) : alreadySent > 0 ? (
              <>
                All priority invites sent ({alreadySent}).
                {pendingBackupDrafts > 0 && <> {pendingBackupDrafts} backup draft{pendingBackupDrafts > 1 ? "s" : ""} standing by.</>}
              </>
            ) : (
              <span className="text-gray-500">No invites set up yet. Open the "Invite staff" dropdown on any position above to start.</span>
            )}
          </div>
          <form action={sendPendingInvitations}>
            <input type="hidden" name="eventId" value={event.id} />
            <button
              type="submit"
              disabled={pendingPrioritySends === 0}
              className={`btn ${pendingPrioritySends === 0 ? "btn-secondary opacity-50 cursor-not-allowed" : "btn-primary"}`}
            >
              {pendingPrioritySends === 0
                ? "Nothing to send"
                : `Send ${pendingPrioritySends} priority invite${pendingPrioritySends > 1 ? "s" : ""}`}
            </button>
          </form>
        </section>

        <section className="mt-8 grid md:grid-cols-2 gap-6">
          <div><h3 className="font-semibold text-sm uppercase text-gray-500 mb-2">Staff notes</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{event.staffNotes || <span className="text-gray-400 italic">No staff notes</span>}</p>
          </div>
          <div><h3 className="font-semibold text-sm uppercase text-gray-500 mb-2">Internal notes</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{event.internalNotes || <span className="text-gray-400 italic">No internal notes</span>}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
