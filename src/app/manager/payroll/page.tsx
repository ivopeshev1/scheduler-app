import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";
import { computePayPeriod, movePayPeriod, computeTotalHours, type Cadence } from "@/lib/pay-period";
import { formatMDY } from "@/lib/format-mdy";
import { PayrollShiftRow } from "@/components/PayrollShiftRow";
import { PayrollMarkAllButton } from "@/components/PayrollMarkAllButton";
import { PayrollReportView, type ReportStaff } from "@/components/PayrollReportView";

/**
 * Server action: save all editable payroll fields for a single shift
 * (clock in/out, break, gratuity) and optionally flip paid_at. Called
 * on blur from each input and from the Mark Paid toggles.
 */
async function saveShiftPayrollAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const invitationId = String(formData.get("invitationId"));
  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, invitationId));
  if (!inv) throw new Error("Not found");
  const [pos] = await db.select().from(schema.positions).where(eq(schema.positions.id, inv.positionId));
  if (!pos) throw new Error("Not found");
  const [ev] = await db.select().from(schema.events).where(eq(schema.events.id, pos.eventId));
  if (!ev || ev.companyId !== session.companyId) throw new Error("Not found");

  function strOrNull(k: string): string | null {
    const v = String(formData.get(k) ?? "").trim();
    return v || null;
  }
  function numOrNull(k: string): number | null {
    const v = String(formData.get(k) ?? "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const update: Record<string, unknown> = {
    clockIn: strOrNull("clockIn"),
    clockOut: strOrNull("clockOut"),
    breakFrom: strOrNull("breakFrom"),
    breakTo: strOrNull("breakTo"),
    gratuity: numOrNull("gratuity"),
  };
  const togglePaidTo = formData.get("togglePaid");
  if (togglePaidTo === "on") {
    update.paidAt = new Date();
  } else if (togglePaidTo === "off") {
    update.paidAt = null;
  }
  await db.update(schema.invitations).set(update).where(eq(schema.invitations.id, invitationId));
  revalidatePath("/manager/payroll");
  revalidatePath(`/manager/event/${ev.id}`);
  revalidatePath(`/manager/month/${ev.date.slice(0, 7)}`);
}

/**
 * Mark every shift in a staff member's row group as paid. Used by the
 * footer "Mark all paid" button under each staff section.
 */
async function markAllPaidAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const ids = String(formData.get("invitationIds") ?? "").split(",").filter(Boolean);
  const mode = String(formData.get("mode") ?? "paid") === "unpaid" ? "unpaid" : "paid";
  if (ids.length === 0) return;
  const now = new Date();
  // Validate every invitation belongs to this company before writing.
  const rows = await db.select({ inv: schema.invitations, pos: schema.positions, ev: schema.events })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .innerJoin(schema.events, eq(schema.positions.eventId, schema.events.id));
  const idsToWrite: string[] = [];
  const monthsToRevalidate = new Set<string>();
  for (const r of rows) {
    if (!ids.includes(r.inv.id)) continue;
    if (r.ev.companyId !== session.companyId) continue;
    idsToWrite.push(r.inv.id);
    monthsToRevalidate.add(r.ev.date.slice(0, 7));
  }
  for (const id of idsToWrite) {
    await db.update(schema.invitations)
      .set({ paidAt: mode === "paid" ? now : null })
      .where(eq(schema.invitations.id, id));
  }
  revalidatePath("/manager/payroll");
  for (const m of monthsToRevalidate) revalidatePath(`/manager/month/${m}`);
}

export default async function PayrollPage({ searchParams }: { searchParams: { on?: string; filter?: string; view?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!company || !user) redirect("/login");
  if (!user.isOwner && !user.canAccessCalendar) redirect("/manager?denied=calendar");

  const cadence: Cadence = (company.payPeriodCadence as Cadence | null) ?? "weekly";
  const anchor = company.payPeriodAnchor ?? null;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // Default landing is the pay period JUST BEFORE today's - payroll is
  // typically processed after a period closes. User can jump to the
  // current (or any) period with the Prev / Next links.
  let period;
  if (searchParams.on && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.on)) {
    period = computePayPeriod(searchParams.on, cadence, anchor);
  } else {
    const thisPeriod = computePayPeriod(todayStr, cadence, anchor);
    period = movePayPeriod(thisPeriod, -1, anchor);
  }

  // Prev / Next date for navigation
  const prevPeriod = movePayPeriod(period, -1, anchor);
  const nextPeriod = movePayPeriod(period, 1, anchor);

  // Pull every accepted invitation + context whose event falls in the
  // current period, scoped to this company. "Accepted" is the right
  // filter: pending shifts haven't happened yet; rejected shouldn't
  // appear on payroll.
  const rows = await db
    .select({
      inv: schema.invitations,
      pos: schema.positions,
      ev: schema.events,
      profile: schema.staffProfiles,
      user: schema.users,
    })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .innerJoin(schema.events, eq(schema.positions.eventId, schema.events.id))
    .innerJoin(schema.users, eq(schema.invitations.userId, schema.users.id))
    .innerJoin(schema.staffProfiles, eq(schema.users.id, schema.staffProfiles.userId));

  const filter = searchParams.filter === "unpaid" ? "unpaid" : searchParams.filter === "paid" ? "paid" : "all";
  // Only accepted shifts count for payroll - whether they're regular
  // or on-call. Pending on-call invites don't owe the staffer anything
  // yet (they haven't confirmed they'll keep the slot free).
  const inPeriod = rows.filter((r) => {
    if (r.ev.companyId !== session.companyId) return false;
    if (r.inv.status !== "accepted") return false;
    if (r.ev.cancelledAt) return false;
    const d = r.ev.date;
    return d >= period.start && d <= period.end;
  });
  const onCallFee = company.onCallFee ?? 0;
  const visible = inPeriod.filter((r) => {
    if (filter === "unpaid") return !r.inv.paidAt;
    if (filter === "paid") return !!r.inv.paidAt;
    return true;
  });

  // Pull per-role rates once so each row can resolve "standard rate" to
  // this staffer's per-role number.
  const allStaffRoles = await db.select().from(schema.staffRoles);
  const rateByUserRole = new Map<string, { rate: number; rateType: "hourly" | "flat" }>();
  for (const r of allStaffRoles) {
    rateByUserRole.set(`${r.userId}::${r.role}`, { rate: r.rate, rateType: r.rateType as "hourly" | "flat" });
  }

  // Add-on lookups: name by id + per-invitation list.
  const allAddOns = await db.select().from(schema.addOns).where(eq(schema.addOns.companyId, session.companyId));
  const addOnNameById = new Map(allAddOns.map((a) => [a.id, a.name]));
  const invAddOnRows = await db.select().from(schema.invitationAddOns);
  const addOnsByInv = new Map<string, Array<{ id: string; amount: number | null }>>();
  for (const r of invAddOnRows) {
    const list = addOnsByInv.get(r.invitationId) ?? [];
    list.push({ id: r.addOnId, amount: r.compensationAmount });
    addOnsByInv.set(r.invitationId, list);
  }

  // Group visible rows by staffer. One section per person, sorted by name.
  type ShiftRow = typeof visible[number];
  const grouped = new Map<string, { name: string; shifts: ShiftRow[] }>();
  for (const r of visible) {
    const key = r.user.id;
    const name = `${r.profile.firstName} ${r.profile.lastName}`.trim();
    const entry = grouped.get(key) ?? { name, shifts: [] };
    entry.shifts.push(r);
    grouped.set(key, entry);
  }
  const groups = Array.from(grouped.entries())
    .map(([userId, g]) => ({
      userId,
      name: g.name,
      shifts: g.shifts.sort((a, b) => a.ev.date.localeCompare(b.ev.date)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Shared helpers for computed columns on the client row component.
  const view = searchParams.view === "report" ? "report" : "edit";
  const buildHref = (on: string, f: string) => `/manager/payroll?on=${on}&filter=${f}&view=${view}`;
  const buildViewHref = (v: "edit" | "report") => `/manager/payroll?on=${period.start}&filter=${filter}&view=${v}`;

  // Pre-build the report payload for the printable / copyable view.
  // Mirrors the editable table's calculations exactly.
  const monthShortNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const reportStaff: ReportStaff[] = groups.map((g) => {
    let staffTotal = 0;
    let allPaid = g.shifts.length > 0;
    const shifts = g.shifts.map((s) => {
      const { rate, rateType } = resolveRate(s.inv, s.pos, s.profile, s.user.id);
      const hours = computeTotalHours(s.inv.clockIn, s.inv.clockOut, s.inv.breakFrom, s.inv.breakTo);
      const baseEarning = rateType === "flat" ? rate : rate * hours;
      const addOns = (addOnsByInv.get(s.inv.id) ?? []).map((a) => ({
        name: addOnNameById.get(a.id) ?? "Add-on",
        amount: a.amount ?? 0,
      }));
      const addOnTotal = addOns.reduce((sum, a) => sum + (a.amount ?? 0), 0);
      const travel = s.inv.travelRate ?? 0;
      const gratuity = s.inv.gratuity ?? 0;
      const total = baseEarning + addOnTotal + travel + gratuity;
      staffTotal += total;
      if (!s.inv.paidAt) allPaid = false;
      const [y, mo, d] = s.ev.date.split("-").map(Number);
      const shortDate = `${monthShortNames[(mo ?? 1) - 1]} ${d ?? 1}`;
      return {
        date: formatMDY(s.ev.date),
        shortDate,
        event: s.ev.clientName,
        role: s.pos.role,
        rate,
        rateType,
        hours,
        earning: baseEarning,
        addOns,
        travel,
        gratuity,
        total,
        paid: !!s.inv.paidAt,
      };
    });
    return { name: g.name, shifts, staffTotal, allPaid };
  });

  // Resolve the effective rate + mode for a shift. Priority:
  //   1. Per-invitee custom override on the invitation
  //   2. Position-level flat/hourly ("the shift pays $200 flat")
  //   3. Standard mode: this staffer's per-role rate; else their
  //      profile defaultRate.
  function resolveRate(
    inv: typeof visible[number]["inv"],
    pos: typeof visible[number]["pos"],
    profile: typeof visible[number]["profile"],
    userId: string,
  ): { rate: number; rateType: "flat" | "hourly" } {
    if (inv.rateOverrideAmount != null) {
      return {
        rate: inv.rateOverrideAmount,
        rateType: inv.rateOverrideMode === "flat" ? "flat" : "hourly",
      };
    }
    if (pos.baseRateMode === "flat") {
      return { rate: pos.baseRate ?? 0, rateType: "flat" };
    }
    if (pos.baseRateMode === "hourly") {
      return { rate: pos.baseRate ?? 0, rateType: "hourly" };
    }
    const match = rateByUserRole.get(`${userId}::${pos.role}`);
    if (match) return { rate: match.rate, rateType: match.rateType };
    return {
      rate: profile.defaultRate ?? 0,
      rateType: profile.defaultRateType === "flat" ? "flat" : "hourly",
    };
  }

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Payroll</h1>
          <div className="flex items-center gap-2">
            <Link href={buildHref(prevPeriod.start, filter)} className="btn btn-secondary text-sm">← Prev</Link>
            <div className="text-sm font-medium px-3">
              {formatMDY(period.start)} — {formatMDY(period.end)}
            </div>
            <Link href={buildHref(nextPeriod.start, filter)} className="btn btn-secondary text-sm">Next →</Link>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mb-4 text-sm print:hidden">
          <div className="flex items-center gap-3">
            <span className="text-gray-500">Filter:</span>
            {(["all", "unpaid", "paid"] as const).map((f) => (
              <Link
                key={f}
                href={buildHref(period.start, f)}
                className={`px-2 py-1 rounded ${filter === f ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100"}`}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </Link>
            ))}
          </div>
          <div className="inline-flex border rounded overflow-hidden">
            <Link
              href={buildViewHref("edit")}
              className={`px-3 py-1 ${view === "edit" ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100"}`}
            >
              Edit
            </Link>
            <Link
              href={buildViewHref("report")}
              className={`px-3 py-1 border-l ${view === "report" ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100"}`}
            >
              Report
            </Link>
          </div>
        </div>

        {view === "report" ? (
          <PayrollReportView
            periodLabel={`${formatMDY(period.start)} — ${formatMDY(period.end)}`}
            filterLabel={filter}
            staff={reportStaff}
          />
        ) : groups.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-gray-500">
            No {filter === "all" ? "" : filter + " "}shifts in this pay period.
          </div>
        ) : (
          groups.map((g) => {
            // Totals per staffer + which optional columns are needed
            // for this section.
            let staffTotal = 0;
            const idsForBulk: string[] = [];
            let sectionHasAddOns = false;
            let sectionHasTravel = false;
            let sectionHasGratuity = false;
            for (const s of g.shifts) {
              const addOns = (addOnsByInv.get(s.inv.id) ?? []).map((a) => ({
                name: addOnNameById.get(a.id) ?? "Add-on",
                amount: a.amount ?? 0,
              }));
              const { rate, rateType } = resolveRate(s.inv, s.pos, s.profile, s.user.id);
              const hours = computeTotalHours(s.inv.clockIn, s.inv.clockOut, s.inv.breakFrom, s.inv.breakTo);
              // On-call shifts pay the standby fee no matter what; if
              // the person was activated into a real slot their regular
              // earning stacks on top of the fee.
              const standby = s.inv.isOnCall ? onCallFee : 0;
              const baseEarning = s.inv.isOnCall ? standby : (rateType === "flat" ? rate : rate * hours);
              const addOnTotal = addOns.reduce((sum, a) => sum + (a.amount ?? 0), 0);
              const travel = s.inv.travelRate ?? 0;
              const gratuity = s.inv.gratuity ?? 0;
              if (addOns.length > 0) sectionHasAddOns = true;
              if (travel > 0) sectionHasTravel = true;
              if (gratuity > 0) sectionHasGratuity = true;
              const total = baseEarning + addOnTotal + travel + gratuity;
              staffTotal += total;
              if (!s.inv.paidAt) idsForBulk.push(s.inv.id);
            }
            const paidIds = g.shifts.filter((s) => s.inv.paidAt).map((s) => s.inv.id);
            // Gratuity column stays visible by default so the manager
            // can still enter a tip even on shifts with none logged yet.
            const showAddOns = sectionHasAddOns;
            const showTravel = sectionHasTravel;
            const showGratuity = true || sectionHasGratuity; // keep editable
            return (
              <section key={g.userId} className="mb-8 border rounded-lg bg-white overflow-hidden">
                <header className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                  <h2 className="font-semibold">{g.name}</h2>
                  <div className="text-sm text-gray-600">
                    {g.shifts.length} shift{g.shifts.length === 1 ? "" : "s"}
                  </div>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-white border-b">
                      <tr className="text-left text-gray-500 uppercase">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Shift</th>
                        <th className="px-3 py-2">Clock in</th>
                        <th className="px-3 py-2">Clock out</th>
                        <th className="px-3 py-2">Break from</th>
                        <th className="px-3 py-2">Break to</th>
                        <th className="px-3 py-2">Hours</th>
                        <th className="px-3 py-2">Earning</th>
                        {showAddOns && <th className="px-3 py-2">Add-ons</th>}
                        {showTravel && <th className="px-3 py-2">Travel</th>}
                        {showGratuity && <th className="px-3 py-2">Gratuity</th>}
                        <th className="px-3 py-2">Total</th>
                        <th className="px-3 py-2">Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.shifts.map((s) => {
                        const { rate, rateType } = resolveRate(s.inv, s.pos, s.profile, s.user.id);
                        const addOns = (addOnsByInv.get(s.inv.id) ?? []).map((a) => ({
                          name: addOnNameById.get(a.id) ?? "Add-on",
                          amount: a.amount ?? 0,
                        }));
                        return (
                          <PayrollShiftRow
                            key={s.inv.id}
                            invitationId={s.inv.id}
                            date={s.ev.date}
                            eventName={s.ev.clientName}
                            role={s.pos.role}
                            rate={rate}
                            rateType={rateType}
                            initialClockIn={s.inv.clockIn}
                            initialClockOut={s.inv.clockOut}
                            initialBreakFrom={s.inv.breakFrom}
                            initialBreakTo={s.inv.breakTo}
                            initialGratuity={s.inv.gratuity}
                            travel={s.inv.travelRate ?? 0}
                            addOns={addOns}
                            paidAt={s.inv.paidAt ? s.inv.paidAt.toISOString() : null}
                            save={saveShiftPayrollAction}
                            showAddOns={showAddOns}
                            showTravel={showTravel}
                            showGratuity={showGratuity}
                            isOnCall={!!s.inv.isOnCall}
                            standbyFee={onCallFee}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <footer className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between gap-2">
                  <div className="font-semibold">
                    Total: ${staffTotal.toFixed(2)}
                  </div>
                  <div className="flex items-center gap-2">
                    {idsForBulk.length > 0 && (
                      <PayrollMarkAllButton
                        invitationIds={idsForBulk}
                        mode="paid"
                        action={markAllPaidAction}
                      />
                    )}
                    {paidIds.length > 0 && (
                      <PayrollMarkAllButton
                        invitationIds={paidIds}
                        mode="unpaid"
                        action={markAllPaidAction}
                      />
                    )}
                  </div>
                </footer>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
