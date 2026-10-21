import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, inArray } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { formatDate, formatTime } from "@/lib/format";
import { resolveRate, shiftPay } from "@/lib/shift-pay";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, greeting, paragraph, kvTable, kvRow, signoff, banner } from "@/lib/email-html";
import { ShiftRosterSection } from "./ShiftRosterSection";
import { CancelShiftButton } from "./CancelShiftButton";

/**
 * Full detail for a single shift the staffer is on. Shows every event
 * field the owner has flagged "share with staff" in Settings, the
 * roster (confirmed teammates on this event, name + phone, collapsible),
 * every attachment (BEOs, run sheets, floor plans) if attachments are
 * shared, and a Cancel-this-shift button with a reason field that
 * emails the manager.
 */

async function cancelShiftAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const inviteId = String(formData.get("inviteId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, inviteId));
  if (!inv || inv.userId !== session.userId) throw new Error("Not found");
  if (inv.cancelledAt) {
    // idempotent: already cancelled, just bounce back
    redirect("/staff");
  }

  // Mark the invitation cancelled; also free its slot so the manager sees
  // the opening on the roster and can promote a backup / rebook.
  await db
    .update(schema.invitations)
    .set({ cancelledAt: new Date(), status: "rejected" })
    .where(eq(schema.invitations.id, inviteId));
  if (inv.slotId) {
    await db
      .update(schema.slots)
      .set({ acceptedUserId: null, acceptedAt: null })
      .where(eq(schema.slots.id, inv.slotId));
  }

  // Load context for the manager notification.
  const [pos] = await db.select().from(schema.positions).where(eq(schema.positions.id, inv.positionId));
  const [evt] = pos ? await db.select().from(schema.events).where(eq(schema.events.id, pos.eventId)) : [null];
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const companyName = company?.name ?? "Scheduler";
  const staffName = profile ? `${profile.firstName} ${profile.lastName}` : me?.email ?? "Someone";

  // Notify every manager in the company (owners + managers with calendar access).
  const managers = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.companyId, session.companyId), eq(schema.users.role, "manager")));
  const recipients = managers.filter((u) => u.isOwner || u.canAccessCalendar);
  const subject = `[${companyName}] ${staffName} cancelled a shift`;
  const bodyLines = [
    `${staffName} cancelled their ${pos?.role ?? "shift"} on ${evt?.date ? formatDate(evt.date) : ""}${evt?.venue ? ` at ${evt.venue}` : ""}.`,
    reason ? `Reason: ${reason}` : "They did not give a reason.",
    `Open the event in ${companyName} to find a replacement.`,
  ];
  for (const mgr of recipients) {
    await sendEmail({
      to: mgr.email,
      companyId: session.companyId,
      userId: mgr.id,
      notificationKey: "staffCancellation",
      subject,
      body: bodyLines.join("\n\n"),
      html: shellWrap(
        [
          banner(`${staffName} cancelled a shift`, "warning"),
          greeting(null, bodyLines[0]),
          reason ? paragraph(`Reason: ${reason}`) : paragraph(`They did not give a reason.`, { muted: true }),
          kvTable([
            kvRow("Event date", evt?.date ? formatDate(evt.date) : "—"),
            kvRow("Venue", evt?.venue ?? "—"),
            kvRow("Role", pos?.role ?? "—"),
          ]),
          paragraph(`Open the event in ${companyName} to find a replacement.`, { muted: true }),
          signoff(companyName),
        ].join("\n"),
      ),
    });
  }

  revalidatePath("/staff");
  redirect("/staff?cancelled=1");
}

export default async function ShiftDetailPage({ params }: { params: { inviteId: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "staff") redirect("/manager");

  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, params.inviteId));
  if (!inv || inv.userId !== session.userId) redirect("/staff");

  const [pos] = await db.select().from(schema.positions).where(eq(schema.positions.id, inv.positionId));
  if (!pos) redirect("/staff");
  const [evt] = await db.select().from(schema.events).where(eq(schema.events.id, pos.eventId));
  if (!evt) redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));

  const cancelled = !!inv.cancelledAt || !!evt.cancelledAt;

  // Which fields does the owner share with staff?
  const configs = await db
    .select()
    .from(schema.eventFieldConfigs)
    .where(eq(schema.eventFieldConfigs.companyId, session.companyId));
  const shared = new Set(configs.filter((c) => c.enabled && c.shareWithStaff).map((c) => c.fieldKey));
  const show = (key: string) => shared.has(key);

  // Attachments (only if share-with-staff is true for the attachments key).
  const attachments = show("attachments")
    ? await db.select().from(schema.eventAttachments).where(eq(schema.eventAttachments.eventId, evt.id))
    : [];

  // Custom values for custom fields that are shared with staff.
  const customConfigs = configs.filter((c) => c.enabled && c.shareWithStaff && c.isCustom);
  const customValues = customConfigs.length
    ? await db.select().from(schema.eventCustomValues).where(eq(schema.eventCustomValues.eventId, evt.id))
    : [];
  const customByKey = new Map(customValues.map((v) => [v.fieldKey, v.value]));

  // Roster: every other staffer confirmed (accepted, not cancelled) on this event.
  const eventPositions = await db.select().from(schema.positions).where(eq(schema.positions.eventId, evt.id));
  const posIds = eventPositions.map((p) => p.id);
  const otherInvites = posIds.length
    ? await db
        .select()
        .from(schema.invitations)
        .where(
          and(
            inArray(schema.invitations.positionId, posIds),
            eq(schema.invitations.status, "accepted"),
          ),
        )
    : [];
  const confirmedOthers = otherInvites.filter((i) => !i.cancelledAt);
  const otherUserIds = Array.from(new Set(confirmedOthers.map((i) => i.userId))).filter((id) => id !== session.userId);
  const otherUsers = otherUserIds.length
    ? await db.select().from(schema.users).where(inArray(schema.users.id, otherUserIds))
    : [];
  const otherProfiles = otherUserIds.length
    ? await db.select().from(schema.staffProfiles).where(inArray(schema.staffProfiles.userId, otherUserIds))
    : [];
  const posByIdMap = new Map(eventPositions.map((p) => [p.id, p]));
  const roster = otherUsers.map((u) => {
    const prof = otherProfiles.find((p) => p.userId === u.id) ?? null;
    const invs = confirmedOthers.filter((i) => i.userId === u.id);
    const roles = Array.from(new Set(invs.map((i) => posByIdMap.get(i.positionId)?.role ?? "").filter(Boolean)));
    return { userId: u.id, firstName: prof?.firstName ?? null, lastName: prof?.lastName ?? null, phone: prof?.phone ?? null, email: u.email, roles, isOnCall: invs.some((i) => i.isOnCall) };
  });

  // My own rate for this shift.
  const myRoles = await db.select().from(schema.staffRoles).where(eq(schema.staffRoles.userId, session.userId));
  const rateByRole = new Map(myRoles.map((r) => [r.role, { rate: r.rate, rateType: r.rateType as "hourly" | "flat" }]));
  const resolved = resolveRate(
    { rateOverrideAmount: inv.rateOverrideAmount, rateOverrideMode: inv.rateOverrideMode as ("flat" | "hourly" | null) },
    { role: pos.role, baseRate: pos.baseRate, baseRateMode: pos.baseRateMode as ("standard" | "flat" | "hourly" | null) },
    { defaultRate: profile?.defaultRate ?? null, defaultRateType: (profile?.defaultRateType as ("hourly" | "flat" | "both" | null)) ?? null },
    rateByRole.get(pos.role) ?? null,
  );
  const hours = hoursBetween(evt.checkInTime, evt.endTime);
  const estPay = shiftPay({ rate: resolved.rate, rateType: resolved.rateType, hours, isOnCall: !!inv.isOnCall });

  const beoStatus = inv.beoReceivedAt
    ? { label: "Received", tone: "ok" as const }
    : inv.beoSentAt
    ? { label: "Sent — not yet acknowledged", tone: "warn" as const }
    : { label: "Not sent yet", tone: "muted" as const };

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" logoUrl={company.logoUrl} />
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link href="/staff" className="text-sm text-gray-500 hover:underline">← Back to my shifts</Link>
        </div>

        {cancelled && (
          <div className="border-2 border-red-500 bg-red-50 rounded p-4 text-sm text-red-800 font-semibold">
            {evt.cancelledAt ? "This event has been cancelled by the manager." : "You've cancelled this shift."}
          </div>
        )}

        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">
            {show("date") && formatDate(evt.date)}
          </div>
          <h1 className="text-2xl font-semibold">
            {pos.role}{inv.isOnCall ? " (on-call)" : ""}
            {show("venue") && evt.venue ? ` at ${evt.venue}` : ""}
          </h1>
          {show("cityAddress") && evt.city && <div className="text-sm text-gray-600 mt-1">{evt.city}</div>}
          {show("clientName") && evt.clientName && (
            <div className="text-sm text-gray-600 mt-1">Client: {evt.clientName}</div>
          )}
          {show("eventType") && evt.eventType && (
            <div className="text-sm text-gray-600 mt-1">Event type: {evt.eventType}</div>
          )}
        </div>

        <section className="border rounded-lg p-5 bg-white">
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Shift details</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {show("checkInTime") && <DetailRow label="Check in" value={formatTime(evt.checkInTime) || "—"} />}
            {show("eventStartTime") && <DetailRow label="Event start" value={formatTime(evt.eventStartTime) || "—"} />}
            {show("endTime") && <DetailRow label="End" value={formatTime(evt.endTime) || "—"} />}
            <DetailRow label="Hours" value={formatHours(hours)} />
            <DetailRow label="Rate" value={resolved.rateType === "hourly" ? `$${resolved.rate.toFixed(2)}/hr` : `$${resolved.rate.toFixed(2)} flat`} />
            {show("guestCount") && evt.guestCount != null && <DetailRow label="Guests" value={String(evt.guestCount)} />}
            {show("numBars") && evt.numBars != null && <DetailRow label="Bars" value={String(evt.numBars)} />}
            <DetailRow
              label="BEO"
              value={
                <span
                  className={
                    beoStatus.tone === "ok" ? "text-green-700 font-medium" : beoStatus.tone === "warn" ? "text-amber-700 font-medium" : "text-gray-500"
                  }
                >
                  {beoStatus.label}
                </span>
              }
            />
          </dl>

          {show("plannerName") && evt.planner && (
            <div className="mt-4 text-sm">
              <span className="text-gray-500">Planner:</span> {evt.planner}
              {show("plannerContactInfo") && evt.plannerContactInfo && (
                <span className="text-gray-500"> · {evt.plannerContactInfo}</span>
              )}
            </div>
          )}
          {show("clientContactInfo") && evt.clientContactInfo && (
            <div className="mt-2 text-sm">
              <span className="text-gray-500">Client contact:</span> {evt.clientContactInfo}
            </div>
          )}

          {evt.vanDrivingInstructions && (
            <div className="mt-4 text-sm">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Van driving</div>
              <div className="whitespace-pre-wrap">{evt.vanDrivingInstructions}</div>
            </div>
          )}

          {evt.staffNotes && (
            <div className="mt-4 text-sm">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Notes from your manager</div>
              <div className="whitespace-pre-wrap">{evt.staffNotes}</div>
            </div>
          )}

          {customConfigs.length > 0 && (
            <div className="mt-4 text-sm space-y-2">
              {customConfigs.map((c) => {
                const v = customByKey.get(c.fieldKey);
                if (!v) return null;
                return (
                  <div key={c.fieldKey}>
                    <span className="text-gray-500">{c.label}:</span> {v}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {attachments.length > 0 && (
          <section className="border rounded-lg p-5 bg-white">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
              Attachments ({attachments.length})
            </h2>
            <ul className="space-y-2">
              {attachments.map((a) => (
                <li key={a.id}>
                  <a href={a.fileData} download={a.fileName} className="text-sm text-blue-700 underline break-all">
                    {a.fileName}
                  </a>
                  <span className="text-xs text-gray-500 ml-2">
                    {(a.fileSize / 1024).toFixed(0)} KB
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ShiftRosterSection roster={roster} />

        {!cancelled && (
          <section className="border border-red-200 rounded-lg p-5 bg-white">
            <h2 className="text-xs uppercase tracking-wide text-red-600 font-semibold mb-2">
              Can&apos;t make it?
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              Let your manager know as soon as possible so they have time to find a replacement.
              You can add a short reason — it&apos;s shared with the manager, not the client.
            </p>
            <CancelShiftButton inviteId={inv.id} action={cancelShiftAction} />
          </section>
        )}
      </main>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs uppercase tracking-wide text-gray-500 w-24 shrink-0">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function hoursBetween(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  if ([fh, fm, th, tm].some((n) => !Number.isFinite(n))) return 0;
  let mins = th * 60 + tm - (fh * 60 + fm);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

function formatHours(h: number): string {
  if (h <= 0) return "—";
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  if (minutes === 0) return `${whole}h`;
  return `${whole}h ${minutes}m`;
}
