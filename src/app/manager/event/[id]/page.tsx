import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { summarizePosition } from "@/lib/status";
import { composeRateLines, sendEmail } from "@/lib/notifications";
import { StaffPicker, type StaffOption } from "@/components/StaffPicker";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

const ELIGIBILITY: Record<string, string[]> = {
  "Bar Lead":  ["Lead"], "Bar Back":  ["Bar Back"], "Bartender": ["Bartender"],
  "Server":    ["Server"], "Cashier":   ["Cashier"],
};

async function saveInvitations(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const positionId = String(formData.get("positionId"));
  const eventId = String(formData.get("eventId"));
  const selections = JSON.parse(String(formData.get("selections") ?? "{}")) as Record<string, number | null>;

  const [position] = await db.select().from(schema.positions).where(eq(schema.positions.id, positionId));
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!position || !event) throw new Error("Not found");

  const existing = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, positionId));

  for (const [userId, tierRaw] of Object.entries(selections)) {
    const tier = tierRaw === null || tierRaw === undefined ? null : Number(tierRaw);
    const current = existing.find((e) => e.userId === userId);

    if (tier === null) {
      if (current && current.status === "pending") {
        await db.delete(schema.invitations).where(eq(schema.invitations.id, current.id));
      }
      continue;
    }

    if (current) {
      if (current.status === "pending") {
        await db.update(schema.invitations).set({ tier }).where(eq(schema.invitations.id, current.id));
      }
    } else {
      const id = nanoid();
      const shouldSendNow = tier === 0;
      await db.insert(schema.invitations).values({
        id, positionId, userId, tier, status: "pending",
        sentAt: shouldSendNow ? new Date() : null, token: nanoid(32),
      });

      if (shouldSendNow) {
        const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
        const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId));
        if (user) {
          const rate = composeRateLines({
            baseRate: position.baseRate, vanDrivingRate: position.vanDrivingRate,
            requiresVanDriving: position.requiresVanDriving, rateType: position.rateType,
          });
          await sendEmail({
            to: user.email,
            subject: `Shift invite: ${event.clientName} on ${event.date}`,
            body: [
              `Hi ${profile?.firstName ?? ""},`, ``,
              `You're invited to work the following event:`, ``,
              `Client:   ${event.clientName}`,
              `Date:     ${event.date}`,
              `Time:     ${event.checkInTime ?? "TBD"} – ${event.endTime ?? "TBD"}`,
              `Venue:    ${event.venue ?? ""} ${event.city ? `(${event.city})` : ""}`.trim(),
              `Role:     ${position.role}`, ``, rate.combined, ``,
              event.staffNotes ? `Notes: ${event.staffNotes}` : "", ``,
              `Accept or reject this shift at your staff dashboard.`,
            ].filter(Boolean).join("\n"),
            companyId: session.companyId, userId, relatedInvitationId: id,
          });
        }
      }
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

  function buildStaffOptions(positionRole: string, positionId: string): StaffOption[] {
    const eligibleRoles = ELIGIBILITY[positionRole] ?? [positionRole];
    const invites = invitesByPosition[positionId] ?? [];
    return staffOnly
      .filter((r) => eligibleRoles.includes(r.profile.position))
      .map((r) => {
        const inv = invites.find((i) => i.userId === r.user.id);
        return {
          userId: r.user.id, firstName: r.profile.firstName, lastName: r.profile.lastName,
          city: r.profile.city, defaultRate: r.profile.defaultRate,
          defaultRateType: r.profile.defaultRateType,
          currentTier: inv ? inv.tier : null, currentStatus: inv ? inv.status : null,
        };
      });
  }

  const statuses = await Promise.all(positionsList.map((p) => summarizePosition(p.id)));

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        <div className="mt-4">
          <h1 className="text-3xl font-semibold">{event.clientName}</h1>
          <div className="text-gray-600 mt-1">
            {event.eventType ?? "—"}
            {event.venue ? ` · ${event.venue}` : ""}
            {event.city ? `, ${event.city}` : ""}
          </div>
          <div className="text-gray-600">
            {event.date} · {event.checkInTime ?? "—"} to {event.endTime ?? "—"}
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
                <th className="text-left">Mode</th>
                <th className="text-left">Staff / Status</th>
                <th className="text-left">Rate</th>
                <th className="text-left">Invite staff</th>
              </tr>
            </thead>
            <tbody>
              {positionsList.map((p, i) => {
                const s = statuses[i];
                const rate = composeRateLines({
                  baseRate: p.baseRate, vanDrivingRate: p.vanDrivingRate,
                  requiresVanDriving: p.requiresVanDriving, rateType: p.rateType,
                });
                const staffOptions = buildStaffOptions(p.role, p.id);
                return (
                  <tr key={p.id} className="border-b align-top">
                    <td className="py-3">{p.needed}</td>
                    <td className="py-3 font-medium">{p.role}</td>
                    <td className="py-3 text-sm text-gray-600 capitalize">{p.mode}</td>
                    <td className={`py-3 ${s.state === "pending" ? "status-pending" : "status-confirmed"}`}>{s.label}</td>
                    <td className="py-3 text-sm">
                      <div>{rate.headline.replace("Rate for this event is ", "")}</div>
                      {p.requiresVanDriving && (<div className="text-xs text-gray-500">+ van ${p.vanDrivingRate}</div>)}
                    </td>
                    <td className="py-3">
                      <StaffPicker positionId={p.id} eventId={event.id} role={p.role} needed={p.needed} mode={p.mode} staff={staffOptions} onSave={saveInvitations} />
                    </td>
                  </tr>
                );
              })}
              {positionsList.length === 0 && (<tr><td colSpan={6} className="py-6 text-center text-gray-400">No positions yet.</td></tr>)}
            </tbody>
          </table>
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
