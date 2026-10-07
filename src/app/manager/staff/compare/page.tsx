import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, isNull } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { computeTotalHours } from "@/lib/pay-period";
import { revalidatePath } from "next/cache";

/**
 * All-staff comparison + manual ranking page. Each row shows the same
 * reliability + money metrics as the single-staff log, side by side,
 * so a manager can compare at a glance. Up/down arrows reorder: the
 * saved rank drives StaffPicker's default order (ranked staff float to
 * the top in order, unranked fall through to alphabetical).
 */

async function moveRankAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const userId = String(formData.get("userId"));
  const direction = String(formData.get("direction")); // "up" | "down"
  if (direction !== "up" && direction !== "down") return;

  // Load every active staff member for this company so we can build the
  // current ranked order and shuffle one row by one position.
  const rows = await db
    .select({ profile: schema.staffProfiles, user: schema.users })
    .from(schema.staffProfiles)
    .innerJoin(schema.users, eq(schema.staffProfiles.userId, schema.users.id))
    .where(and(eq(schema.users.companyId, session.companyId), isNull(schema.users.archivedAt)));

  // Normalize: ranked first (by rank), unranked after (alphabetical). After
  // the move we rewrite everyone's rank_order 1..N so the ordering is stable.
  const sorted = rows.slice().sort(sortByRankThenName);
  const idx = sorted.findIndex((r) => r.profile.userId === userId);
  if (idx < 0) return;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= sorted.length) return;
  const next = sorted.slice();
  const tmp = next[idx];
  next[idx] = next[swapWith];
  next[swapWith] = tmp;

  for (let i = 0; i < next.length; i++) {
    await db
      .update(schema.staffProfiles)
      .set({ rankOrder: i + 1 })
      .where(eq(schema.staffProfiles.userId, next[i].profile.userId));
  }
  revalidatePath("/manager/staff/compare");
  revalidatePath("/manager/staff");
}

async function clearRankingsAction() {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const rows = await db
    .select({ userId: schema.staffProfiles.userId })
    .from(schema.staffProfiles)
    .innerJoin(schema.users, eq(schema.staffProfiles.userId, schema.users.id))
    .where(eq(schema.users.companyId, session.companyId));
  for (const r of rows) {
    await db.update(schema.staffProfiles).set({ rankOrder: null }).where(eq(schema.staffProfiles.userId, r.userId));
  }
  revalidatePath("/manager/staff/compare");
  revalidatePath("/manager/staff");
}

function sortByRankThenName(
  a: { profile: typeof schema.staffProfiles.$inferSelect },
  b: { profile: typeof schema.staffProfiles.$inferSelect },
): number {
  const ar = a.profile.rankOrder;
  const br = b.profile.rankOrder;
  if (ar != null && br != null) return ar - br;
  if (ar != null) return -1;
  if (br != null) return 1;
  return a.profile.firstName.localeCompare(b.profile.firstName);
}

export default async function StaffComparePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me) redirect("/login");
  if (!me.isOwner && !me.canAccessStaff) redirect("/manager?denied=staff");

  // All active staff + their shift history, batched. Metrics are computed per
  // staffer from the same join the single-staff log page uses.
  const staffRows = await db
    .select({ profile: schema.staffProfiles, user: schema.users })
    .from(schema.staffProfiles)
    .innerJoin(schema.users, eq(schema.staffProfiles.userId, schema.users.id))
    .where(and(eq(schema.users.companyId, session.companyId), isNull(schema.users.archivedAt), eq(schema.users.role, "staff")));

  const invRows = await db
    .select({ inv: schema.invitations, pos: schema.positions, ev: schema.events })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .innerJoin(schema.events, eq(schema.positions.eventId, schema.events.id))
    .where(eq(schema.events.companyId, session.companyId));

  const staffRolesRows = await db.select().from(schema.staffRoles);
  const rateKey = (userId: string, role: string) => `${userId}::${role}`;
  const rateMap = new Map<string, { rate: number; rateType: "hourly" | "flat" }>();
  for (const r of staffRolesRows) {
    rateMap.set(rateKey(r.userId, r.role), { rate: r.rate, rateType: r.rateType as "hourly" | "flat" });
  }

  const today = new Date().toISOString().slice(0, 10);

  type Stats = {
    accepted: number; decidable: number; responded: number;
    noShows: number; pastAccepted: number; lateCount: number;
    onCallCount: number; onCallActivated: number;
    paidTotal: number; paidShiftCount: number; unpaidTotal: number;
    totalHours: number;
  };
  const statsBy = new Map<string, Stats>();
  for (const s of staffRows) {
    statsBy.set(s.user.id, {
      accepted: 0, decidable: 0, responded: 0,
      noShows: 0, pastAccepted: 0, lateCount: 0,
      onCallCount: 0, onCallActivated: 0,
      paidTotal: 0, paidShiftCount: 0, unpaidTotal: 0,
      totalHours: 0,
    });
  }

  function resolveRate(inv: typeof invRows[number]["inv"], pos: typeof invRows[number]["pos"], profile: typeof schema.staffProfiles.$inferSelect) {
    if (inv.rateOverrideAmount != null) {
      return { rate: inv.rateOverrideAmount, rateType: inv.rateOverrideMode === "flat" ? "flat" : "hourly" };
    }
    if (pos.baseRateMode === "flat") return { rate: pos.baseRate ?? 0, rateType: "flat" as const };
    if (pos.baseRateMode === "hourly") return { rate: pos.baseRate ?? 0, rateType: "hourly" as const };
    const m = rateMap.get(rateKey(profile.userId, pos.role));
    if (m) return m;
    return {
      rate: profile.defaultRate ?? 0,
      rateType: (profile.defaultRateType === "flat" ? "flat" : "hourly") as "flat" | "hourly",
    };
  }

  const profileByUser = new Map(staffRows.map((s) => [s.user.id, s.profile]));
  for (const { inv, pos, ev } of invRows) {
    const stats = statsBy.get(inv.userId);
    const profile = profileByUser.get(inv.userId);
    if (!stats || !profile) continue;

    if (inv.status === "accepted") stats.accepted++;
    if (inv.status === "accepted" || inv.status === "rejected") stats.responded++;
    if (inv.status === "accepted" || inv.status === "rejected" || inv.status === "expired") stats.decidable++;

    const wasOnCall = inv.isOnCall || inv.activationRequestedAt != null;
    if (wasOnCall) {
      stats.onCallCount++;
      if (inv.activationRequestedAt != null && inv.status === "accepted") stats.onCallActivated++;
    }

    const pastEvent = ev.date < today;
    if (pastEvent && inv.status === "accepted" && !inv.isOnCall) {
      stats.pastAccepted++;
      if (!inv.clockIn) stats.noShows++;
      if (inv.clockIn && ev.checkInTime) {
        const [sh, sm] = ev.checkInTime.split(":").map(Number);
        const [ah, am] = inv.clockIn.split(":").map(Number);
        if ([sh, sm, ah, am].every(Number.isFinite)) {
          const late = (ah * 60 + am) - (sh * 60 + sm);
          if (late > 5) stats.lateCount++;
        }
      }
    }

    const pay = inv.isOnCall
      ? (company.onCallFee ?? 0)
      : (() => {
          const { rate, rateType } = resolveRate(inv, pos, profile);
          if (rateType === "flat") return rate + (inv.gratuity ?? 0);
          const hrs = computeTotalHours(inv.clockIn, inv.clockOut, inv.breakFrom, inv.breakTo);
          return rate * hrs + (inv.gratuity ?? 0);
        })();

    if (inv.paidAt) {
      stats.paidTotal += pay;
      stats.paidShiftCount++;
    } else if (inv.status === "accepted" && pastEvent) {
      stats.unpaidTotal += pay;
    }
    stats.totalHours += computeTotalHours(inv.clockIn, inv.clockOut, inv.breakFrom, inv.breakTo);
  }

  const sorted = staffRows.slice().sort(sortByRankThenName);
  const anyRanked = sorted.some((r) => r.profile.rankOrder != null);

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={me.email} role="manager" logoUrl={company.logoUrl} isOwner={!!me.isOwner} canAccessCalendar={!!me.canAccessCalendar} canAccessStaff={!!me.canAccessStaff} canAccessLog={!!me.canAccessLog} canAccessTeam={!!me.canAccessTeam} canEditSettings={!!me.canEditSettings} />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
            <h1 className="text-2xl font-semibold mt-1">Compare &amp; rank staff</h1>
            <p className="text-sm text-gray-600 mt-1">
              Order sets the default position in the StaffPicker when inviting people. Unranked staff fall through to alphabetical.
            </p>
          </div>
          {anyRanked && (
            <form action={clearRankingsAction}>
              <button className="text-sm text-red-600 hover:underline" title="Clear all manual rankings">Clear all rankings</button>
            </form>
          )}
        </div>

        <div className="border rounded-lg overflow-x-auto bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr className="border-b">
                <th className="text-left px-3 py-2 w-16">Rank</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-right px-3 py-2">Accept</th>
                <th className="text-right px-3 py-2">Response</th>
                <th className="text-right px-3 py-2">No-shows</th>
                <th className="text-right px-3 py-2">Late</th>
                <th className="text-right px-3 py-2">On-call</th>
                <th className="text-right px-3 py-2">Hours</th>
                <th className="text-right px-3 py-2">Shifts</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ profile, user }, i) => {
                const s = statsBy.get(user.id)!;
                const accept = s.decidable > 0 ? (s.accepted / s.decidable) * 100 : null;
                const response = s.decidable > 0 ? (s.responded / s.decidable) * 100 : null;
                const activation = s.onCallCount > 0 ? (s.onCallActivated / s.onCallCount) * 100 : null;
                const avg = s.paidShiftCount > 0 ? s.paidTotal / s.paidShiftCount : null;
                return (
                  <tr key={user.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <span className="w-6 text-gray-600 text-xs">{profile.rankOrder ?? "—"}</span>
                        <form action={moveRankAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button
                            disabled={i === 0}
                            className="px-1 text-gray-500 hover:text-black disabled:text-gray-200 disabled:cursor-not-allowed"
                            title="Move up"
                          >▲</button>
                        </form>
                        <form action={moveRankAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button
                            disabled={i === sorted.length - 1}
                            className="px-1 text-gray-500 hover:text-black disabled:text-gray-200 disabled:cursor-not-allowed"
                            title="Move down"
                          >▼</button>
                        </form>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/manager/staff/${user.id}`} className="hover:underline">
                        <div className="font-medium">{profile.firstName} {profile.lastName}</div>
                        <div className="text-xs text-gray-500">{profile.city ?? ""}</div>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">{fmtPct(accept)}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(response)}</td>
                    <td className={`px-3 py-2 text-right ${s.noShows > 0 ? "text-red-600" : ""}`}>{s.noShows}</td>
                    <td className={`px-3 py-2 text-right ${s.lateCount > 0 ? "text-amber-700" : ""}`}>{s.lateCount}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(activation)}</td>
                    <td className="px-3 py-2 text-right">{s.totalHours.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right">{s.paidShiftCount}</td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-gray-400">No staff yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function fmtPct(v: number | null) { return v == null ? "—" : `${v.toFixed(0)}%`; }
function fmtMoney(v: number | null) {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
