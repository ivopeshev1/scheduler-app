import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, isNull } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { computeTotalHours } from "@/lib/pay-period";
import { revalidatePath } from "next/cache";
import { StaffRankList, type StaffRankRow } from "@/components/StaffRankList";

/**
 * All-staff comparison + manual ranking page. Each row shows reliability
 * metrics side by side, and the manager drags rows to set a priority
 * order. The saved order flows to StaffPicker when inviting people, so
 * your best people land at the top of the picker.
 */

async function reorderAction(orderedUserIds: string[]) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  // Rewrite rank_order for the dragged subset. Users not in the list keep
  // their existing rank (or stay null); if the manager just dragged the
  // whole list from the Compare page, every active staffer is included.
  for (let i = 0; i < orderedUserIds.length; i++) {
    await db
      .update(schema.staffProfiles)
      .set({ rankOrder: i + 1 })
      .where(eq(schema.staffProfiles.userId, orderedUserIds[i]));
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

  const today = new Date().toISOString().slice(0, 10);

  type Stats = {
    accepted: number; decidable: number; responded: number;
    cancelled: number;
    noShows: number; pastAccepted: number; lateCount: number;
    onCallCount: number; onCallActivated: number;
    responseMsSum: number; responseMsCount: number;
    totalHours: number; paidShiftCount: number;
  };
  const statsBy = new Map<string, Stats>();
  for (const s of staffRows) {
    statsBy.set(s.user.id, {
      accepted: 0, decidable: 0, responded: 0,
      cancelled: 0,
      noShows: 0, pastAccepted: 0, lateCount: 0,
      onCallCount: 0, onCallActivated: 0,
      responseMsSum: 0, responseMsCount: 0,
      totalHours: 0, paidShiftCount: 0,
    });
  }

  for (const { inv, ev } of invRows) {
    const stats = statsBy.get(inv.userId);
    if (!stats) continue;

    if (inv.cancelledAt) stats.cancelled++;
    if (inv.status === "accepted") stats.accepted++;
    if (inv.status === "accepted" || inv.status === "rejected") stats.responded++;
    if (inv.status === "accepted" || inv.status === "rejected" || inv.status === "expired") stats.decidable++;

    const wasOnCall = inv.isOnCall || inv.activationRequestedAt != null;
    if (wasOnCall) {
      stats.onCallCount++;
      if (inv.activationRequestedAt != null && inv.status === "accepted") stats.onCallActivated++;
    }

    // Response time only counts invitations the staffer actually responded to.
    if (inv.sentAt && inv.respondedAt && (inv.status === "accepted" || inv.status === "rejected")) {
      const ms = new Date(inv.respondedAt).getTime() - new Date(inv.sentAt).getTime();
      if (ms >= 0) {
        stats.responseMsSum += ms;
        stats.responseMsCount++;
      }
    }

    const pastEvent = ev.date < today;
    if (pastEvent && inv.status === "accepted" && !inv.cancelledAt && !inv.isOnCall) {
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

    stats.totalHours += computeTotalHours(inv.clockIn, inv.clockOut, inv.breakFrom, inv.breakTo);
    if (inv.paidAt) stats.paidShiftCount++;
  }

  const sorted = staffRows.slice().sort(sortByRankThenName);
  const anyRanked = sorted.some((r) => r.profile.rankOrder != null);

  const rankRows: StaffRankRow[] = sorted.map(({ profile, user }) => {
    const s = statsBy.get(user.id)!;
    return {
      userId: user.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      city: profile.city,
      acceptPct: s.decidable > 0 ? (s.accepted / s.decidable) * 100 : null,
      responsePct: s.decidable > 0 ? (s.responded / s.decidable) * 100 : null,
      avgResponseHours: s.responseMsCount > 0 ? s.responseMsSum / s.responseMsCount / (1000 * 60 * 60) : null,
      cancelled: s.cancelled,
      noShows: s.noShows,
      lateCount: s.lateCount,
      activationPct: s.onCallCount > 0 ? (s.onCallActivated / s.onCallCount) * 100 : null,
      totalHours: s.totalHours,
      paidShiftCount: s.paidShiftCount,
    };
  });

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={me.email} role="manager" logoUrl={company.logoUrl} isOwner={!!me.isOwner} canAccessCalendar={!!me.canAccessCalendar} canAccessStaff={!!me.canAccessStaff} canAccessLog={!!me.canAccessLog} canAccessTeam={!!me.canAccessTeam} canEditSettings={!!me.canEditSettings} />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
            <h1 className="text-2xl font-semibold mt-1">Compare &amp; rank staff</h1>
            <p className="text-sm text-gray-600 mt-1">
              Drag rows to rank your staff. Your best people go on top — this is the exact order they appear in the Staff Picker when you invite people to a shift.
            </p>
          </div>
          {anyRanked && (
            <form action={clearRankingsAction}>
              <button className="text-sm text-red-600 hover:underline" title="Clear all manual rankings">Clear all rankings</button>
            </form>
          )}
        </div>

        <StaffRankList initialRows={rankRows} onReorder={reorderAction} />
      </main>
    </div>
  );
}
