import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { computeTotalHours } from "@/lib/pay-period";
import { revalidatePath } from "next/cache";

async function markCancelledAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const invId = String(formData.get("invId"));
  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invId));
  if (!inv) throw new Error("Invitation not found");
  // Free the slot (same as a removal) but keep the invitation row so the
  // cancellation metric can count it.
  if (inv.slotId) {
    await db.update(schema.slots).set({ acceptedUserId: null, acceptedAt: null }).where(eq(schema.slots.id, inv.slotId));
  }
  await db.update(schema.invitations).set({ cancelledAt: new Date() }).where(eq(schema.invitations.id, invId));
  revalidatePath("/manager/staff/compare");
  revalidatePath(`/manager/staff/${inv.userId}`);
}

async function undoCancelAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const invId = String(formData.get("invId"));
  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invId));
  if (!inv) throw new Error("Invitation not found");
  await db.update(schema.invitations).set({ cancelledAt: null }).where(eq(schema.invitations.id, invId));
  revalidatePath("/manager/staff/compare");
  revalidatePath(`/manager/staff/${inv.userId}`);
}

/**
 * Per-staff log + stats page. Everything a manager needs to decide
 * "would I invite this person again" lives here: reliability metrics
 * (accept/response/no-show), punctuality (lateness), and lifetime +
 * YTD + unpaid pay totals. Numbers are computed inline from the
 * invitations/positions/events tables so this is always current.
 */
export default async function StaffLogPage({ params }: { params: { userId: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me) redirect("/login");
  if (!me.isOwner && !me.canAccessStaff) redirect("/manager?denied=staff");

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, params.userId));
  if (!target || target.companyId !== session.companyId || target.role !== "staff") notFound();
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, target.id));

  // Pull every invitation this staffer has ever had, joined with position
  // + event. All metrics derive from this one query.
  const invRows = await db
    .select({
      inv: schema.invitations,
      pos: schema.positions,
      ev: schema.events,
    })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .innerJoin(schema.events, eq(schema.positions.eventId, schema.events.id))
    .where(and(eq(schema.invitations.userId, target.id), eq(schema.events.companyId, session.companyId)));

  // Per-role rates for the standard-mode pay path.
  const staffRolesRows = await db
    .select()
    .from(schema.staffRoles)
    .where(eq(schema.staffRoles.userId, target.id));
  const rateByRole = new Map(staffRolesRows.map((r) => [r.role, { rate: r.rate, rateType: r.rateType as "hourly" | "flat" }]));

  function resolveRate(inv: typeof invRows[number]["inv"], pos: typeof invRows[number]["pos"]): { rate: number; rateType: "flat" | "hourly" } {
    if (inv.rateOverrideAmount != null) {
      return { rate: inv.rateOverrideAmount, rateType: inv.rateOverrideMode === "flat" ? "flat" : "hourly" };
    }
    if (pos.baseRateMode === "flat") return { rate: pos.baseRate ?? 0, rateType: "flat" };
    if (pos.baseRateMode === "hourly") return { rate: pos.baseRate ?? 0, rateType: "hourly" };
    const m = rateByRole.get(pos.role);
    if (m) return { rate: m.rate, rateType: m.rateType };
    return {
      rate: profile?.defaultRate ?? 0,
      rateType: profile?.defaultRateType === "flat" ? "flat" : "hourly",
    };
  }

  function shiftPay(inv: typeof invRows[number]["inv"], pos: typeof invRows[number]["pos"]): number {
    // On-call standby fee from company config (fallback 0) if the shift stayed on-call.
    if (inv.isOnCall) return company.onCallFee ?? 0;
    const { rate, rateType } = resolveRate(inv, pos);
    if (rateType === "flat") return rate + (inv.gratuity ?? 0);
    const hours = computeTotalHours(inv.clockIn, inv.clockOut, inv.breakFrom, inv.breakTo);
    return rate * hours + (inv.gratuity ?? 0);
  }

  function hoursWorked(inv: typeof invRows[number]["inv"]): number {
    return computeTotalHours(inv.clockIn, inv.clockOut, inv.breakFrom, inv.breakTo);
  }

  // Minute-based lateness: positive = minutes late past scheduled check-in.
  function minutesLate(inv: typeof invRows[number]["inv"], ev: typeof invRows[number]["ev"]): number | null {
    if (!inv.clockIn || !ev.checkInTime) return null;
    const [sh, sm] = ev.checkInTime.split(":").map(Number);
    const [ah, am] = inv.clockIn.split(":").map(Number);
    if (![sh, sm, ah, am].every(Number.isFinite)) return null;
    return (ah * 60 + am) - (sh * 60 + sm);
  }

  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;

  // Buckets we'll pass through once each.
  let totalInvites = 0;
  let accepted = 0;
  let rejected = 0;
  let expired = 0;
  let cancelled = 0;
  let onCallCount = 0;
  let onCallActivated = 0;
  let pastAccepted = 0;
  let noShows = 0;
  let lateCount = 0;
  let paidTotal = 0;
  let paidThisYear = 0;
  let unpaidTotal = 0;
  let paidShiftCount = 0;
  let totalHours = 0;

  for (const { inv, pos, ev } of invRows) {
    totalInvites++;
    if (inv.cancelledAt) cancelled++;
    if (inv.status === "accepted") accepted++;
    else if (inv.status === "rejected") rejected++;
    else if (inv.status === "expired") expired++;

    const wasOnCall = inv.isOnCall || inv.activationRequestedAt != null;
    if (wasOnCall) {
      onCallCount++;
      if (inv.activationRequestedAt != null && inv.status === "accepted") onCallActivated++;
    }

    const pastEvent = ev.date < today;
    if (pastEvent && inv.status === "accepted" && !inv.cancelledAt && !inv.isOnCall) {
      pastAccepted++;
      if (!inv.clockIn) noShows++;
      const late = minutesLate(inv, ev);
      if (late != null && late > 5) lateCount++;
    }

    if (inv.paidAt) {
      const pay = shiftPay(inv, pos);
      paidTotal += pay;
      paidShiftCount++;
      if (ev.date >= yearStart) paidThisYear += pay;
    } else if (inv.status === "accepted" && pastEvent) {
      unpaidTotal += shiftPay(inv, pos);
    }

    totalHours += hoursWorked(inv);
  }

  const responded = accepted + rejected;
  const decidable = accepted + rejected + expired;
  const acceptRate = decidable > 0 ? (accepted / decidable) * 100 : null;
  const responseRate = decidable > 0 ? (responded / decidable) * 100 : null;
  const noShowRate = pastAccepted > 0 ? (noShows / pastAccepted) * 100 : null;
  const activationRate = onCallCount > 0 ? (onCallActivated / onCallCount) * 100 : null;
  const avgPerShift = paidShiftCount > 0 ? paidTotal / paidShiftCount : null;

  const fullName = profile ? `${profile.firstName} ${profile.lastName}` : target.email;

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={me.email} role="manager" logoUrl={company.logoUrl} isOwner={!!me.isOwner} canAccessCalendar={!!me.canAccessCalendar} canAccessStaff={!!me.canAccessStaff} canAccessLog={!!me.canAccessLog} canAccessTeam={!!me.canAccessTeam} canEditSettings={!!me.canEditSettings} />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
        <div className="mt-2 mb-6">
          <h1 className="text-2xl font-semibold">{fullName}</h1>
          <div className="text-sm text-gray-600">{target.email}{profile?.phone ? ` · ${profile.phone}` : ""}{profile?.city ? ` · ${profile.city}` : ""}</div>
        </div>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Stat label="Accept rate" value={fmtPct(acceptRate)} sub={`${accepted} of ${decidable} decided`} />
          <Stat label="Response rate" value={fmtPct(responseRate)} sub={`${expired} ghosted`} />
          <Stat label="Cancellations" value={String(cancelled)} sub="accepted then backed out" tone={cancelled > 0 ? "amber" : undefined} />
          <Stat label="No-shows" value={String(noShows)} sub={noShowRate != null ? `${noShowRate.toFixed(0)}% of past shifts` : "no past shifts"} />
          <Stat label="Late (>5 min)" value={String(lateCount)} sub="of past shifts" />
          <Stat label="On-call activation" value={fmtPct(activationRate)} sub={`${onCallActivated} of ${onCallCount} standbys`} />
          <Stat label="Hours worked" value={totalHours.toFixed(1)} sub="all time" />
          <Stat label="Total shifts" value={String(paidShiftCount)} sub="paid" />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          <Stat label="Paid lifetime" value={fmtMoney(paidTotal)} big />
          <Stat label={`Paid in ${new Date().getFullYear()}`} value={fmtMoney(paidThisYear)} big />
          <Stat label="Unpaid (owed)" value={fmtMoney(unpaidTotal)} big tone={unpaidTotal > 0 ? "amber" : undefined} />
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Recent shifts</h2>
          <RecentShifts rows={invRows} shiftPay={shiftPay} />
        </section>
      </main>
    </div>
  );
}

function RecentShifts({
  rows,
  shiftPay,
}: {
  rows: Array<{
    inv: typeof schema.invitations.$inferSelect;
    pos: typeof schema.positions.$inferSelect;
    ev: typeof schema.events.$inferSelect;
  }>;
  shiftPay: (inv: any, pos: any) => number;
}) {
  const recent = [...rows]
    .filter((r) => r.inv.status !== "pending")
    .sort((a, b) => b.ev.date.localeCompare(a.ev.date))
    .slice(0, 20);
  if (recent.length === 0) {
    return <div className="border rounded-lg p-6 text-center text-gray-400 bg-white">No shift history yet.</div>;
  }
  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
          <tr className="border-b">
            <th className="text-left px-4 py-2">Date</th>
            <th className="text-left px-4 py-2">Event</th>
            <th className="text-left px-4 py-2">Role</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="text-right px-4 py-2">Pay</th>
            <th className="text-left px-4 py-2">Paid?</th>
            <th className="text-right px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {recent.map(({ inv, pos, ev }) => (
            <tr key={inv.id} className="border-b last:border-b-0">
              <td className="px-4 py-2 whitespace-nowrap">{ev.date}</td>
              <td className="px-4 py-2">{ev.clientName}</td>
              <td className="px-4 py-2">
                {pos.role}
                {inv.isOnCall && <span className="ml-1 text-xs text-gray-500 italic">on call</span>}
              </td>
              <td className="px-4 py-2 text-xs">
                {inv.cancelledAt
                  ? <span className="text-amber-700">Cancelled</span>
                  : inv.status === "accepted" ? "Accepted"
                  : inv.status === "rejected" ? "Declined"
                  : inv.status === "expired" ? "Ghosted"
                  : inv.status}
              </td>
              <td className="px-4 py-2 text-right">
                {inv.status === "accepted" && !inv.cancelledAt ? `$${shiftPay(inv, pos).toFixed(0)}` : "-"}
              </td>
              <td className="px-4 py-2 text-xs">
                {inv.paidAt ? <span className="text-green-700">Paid</span> : inv.status === "accepted" && !inv.cancelledAt ? <span className="text-gray-500">Unpaid</span> : "-"}
              </td>
              <td className="px-4 py-2 text-right text-xs">
                {inv.cancelledAt ? (
                  <form action={undoCancelAction}>
                    <input type="hidden" name="invId" value={inv.id} />
                    <button className="text-gray-500 hover:underline" title="Undo cancellation">Undo</button>
                  </form>
                ) : inv.status === "accepted" ? (
                  <form action={markCancelledAction}>
                    <input type="hidden" name="invId" value={inv.id} />
                    <button className="text-amber-700 hover:underline" title="Mark as cancelled by staff">Cancel</button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, big, tone }: { label: string; value: string; sub?: string; big?: boolean; tone?: "amber" }) {
  const toneCls = tone === "amber" ? "text-amber-700" : "text-gray-900";
  return (
    <div className="border rounded-lg px-4 py-3 bg-white">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`${big ? "text-2xl" : "text-xl"} font-semibold mt-1 ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`;
}
function fmtMoney(v: number | null): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
