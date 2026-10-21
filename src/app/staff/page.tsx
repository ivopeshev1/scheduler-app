import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { formatDate, formatTime } from "@/lib/format";
import { resolveRate, shiftPay } from "@/lib/shift-pay";

/**
 * Staff home page. Every logged-in staffer lands here. Three sections:
 *   1. Hero "Next shift" card - the single most relevant upcoming confirmed shift,
 *      pulled out so the staffer doesn't have to scan a list on login.
 *   2. Pending invitations - unanswered shift offers, with Accept + Decline buttons
 *      that hit the same /invite/[token]/[action] endpoint the emails use.
 *   3. Upcoming confirmed shifts - every accepted shift from today forward, newest first.
 *
 * Silent-backup rule: an invitation with tier > 0 and sentAt null is a backup
 * the system is holding behind the priority invitees - it's NOT a real offer
 * yet, so we filter those out of the Pending list.
 */
export default async function StaffHomePage({ searchParams }: { searchParams: { welcome?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "staff") redirect("/manager");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));

  // Pull every invitation this user has that's still relevant (not cancelled,
  // not rejected, not expired). Then join to position + event in one pass so
  // we can filter by date + render in a single list.
  const invitations = await db
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.userId, session.userId),
        inArray(schema.invitations.status, ["pending", "accepted"]),
        isNull(schema.invitations.cancelledAt),
      ),
    );
  const positionIds = Array.from(new Set(invitations.map((i) => i.positionId)));
  const positionsList = positionIds.length
    ? await db.select().from(schema.positions).where(inArray(schema.positions.id, positionIds))
    : [];
  const eventIds = Array.from(new Set(positionsList.map((p) => p.eventId)));
  const eventsList = eventIds.length
    ? await db.select().from(schema.events).where(inArray(schema.events.id, eventIds))
    : [];
  const posById = new Map(positionsList.map((p) => [p.id, p]));
  const evtById = new Map(eventsList.map((e) => [e.id, e]));
  // Staffer's per-role rates; used as the fallback when the position is in
  // "standard" rate mode (no override, no position-flat/hourly rate).
  const staffRolesList = await db
    .select()
    .from(schema.staffRoles)
    .where(eq(schema.staffRoles.userId, session.userId));
  const rateByRole = new Map(
    staffRolesList.map((r) => [r.role, { rate: r.rate, rateType: r.rateType as "hourly" | "flat" }]),
  );
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, local-ish

  type Row = {
    inv: typeof invitations[number];
    pos: typeof positionsList[number];
    evt: typeof eventsList[number];
    estPay: number;
  };
  const rows: Row[] = [];
  for (const inv of invitations) {
    const pos = posById.get(inv.positionId);
    if (!pos) continue;
    const evt = evtById.get(pos.eventId);
    if (!evt) continue;
    if (evt.cancelledAt) continue;
    if (evt.date < today) continue;
    // Silent backup: still being held in reserve, don't show as a real invite.
    if (inv.status === "pending" && inv.tier > 0 && !inv.sentAt) continue;
    const resolved = resolveRate(
      { rateOverrideAmount: inv.rateOverrideAmount, rateOverrideMode: inv.rateOverrideMode as ("flat" | "hourly" | null) },
      { role: pos.role, baseRate: pos.baseRate, baseRateMode: pos.baseRateMode as ("standard" | "flat" | "hourly" | null) },
      { defaultRate: profile?.defaultRate ?? null, defaultRateType: (profile?.defaultRateType as ("hourly" | "flat" | "both" | null)) ?? null },
      rateByRole.get(pos.role) ?? null,
    );
    const estPay = shiftPay({
      rate: resolved.rate,
      rateType: resolved.rateType,
      hours: hoursBetween(evt.checkInTime, evt.endTime),
      isOnCall: !!inv.isOnCall,
    });
    rows.push({ inv, pos, evt, estPay });
  }

  // Sort by date (then start-of-day for stability). Next shift is the first
  // accepted row chronologically.
  rows.sort((a, b) => (a.evt.date === b.evt.date ? (a.evt.checkInTime ?? "").localeCompare(b.evt.checkInTime ?? "") : a.evt.date.localeCompare(b.evt.date)));
  const pending = rows.filter((r) => r.inv.status === "pending");
  const confirmed = rows.filter((r) => r.inv.status === "accepted");
  const nextShift = confirmed[0] ?? null;

  const showWelcome = searchParams.welcome === "1";

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" logoUrl={company.logoUrl} />
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {showWelcome && (
          <div className="border border-green-300 bg-green-50 rounded p-4 text-sm text-green-900">
            Welcome aboard, {profile?.firstName ?? "there"}! Your account is set up. Your manager can start sending you shift invites now.
          </div>
        )}

        <div>
          <h1 className="text-2xl font-semibold">Hi {profile?.firstName ?? user.email.split("@")[0]}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {pending.length > 0
              ? `You have ${pending.length} new shift invite${pending.length === 1 ? "" : "s"} waiting.`
              : confirmed.length > 0
              ? `${confirmed.length} upcoming shift${confirmed.length === 1 ? "" : "s"} on your calendar.`
              : "Nothing on your calendar right now. Your manager will reach out when they have shifts to offer."}
          </p>
        </div>

        {nextShift && (
          <section>
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Next shift</h2>
            <NextShiftCard row={nextShift} />
          </section>
        )}

        {pending.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
              Pending invitations ({pending.length})
            </h2>
            <ul className="space-y-3">
              {pending.map((r) => (
                <PendingInviteCard key={r.inv.id} row={r} />
              ))}
            </ul>
          </section>
        )}

        {confirmed.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
              Upcoming confirmed shifts ({confirmed.length})
            </h2>
            <ul className="space-y-2">
              {confirmed.map((r) => (
                <ConfirmedShiftRow key={r.inv.id} row={r} isNext={r === nextShift} />
              ))}
            </ul>
          </section>
        )}

        {rows.length === 0 && (
          <div className="border rounded-lg p-10 text-center text-gray-500">
            Nothing on your calendar yet.
          </div>
        )}
      </main>
    </div>
  );
}

type Row = {
  inv: typeof schema.invitations.$inferSelect;
  pos: typeof schema.positions.$inferSelect;
  evt: typeof schema.events.$inferSelect;
  estPay: number;
};

/** HH:MM diff in decimal hours. Null-safe + returns 0 for missing/invalid. */
function hoursBetween(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  if ([fh, fm, th, tm].some((n) => !Number.isFinite(n))) return 0;
  let mins = th * 60 + tm - (fh * 60 + fm);
  if (mins < 0) mins += 24 * 60; // overnight shift
  return mins / 60;
}

function NextShiftCard({ row }: { row: Row }) {
  const { inv, pos, evt, estPay } = row;
  return (
    <div className="border-2 border-black rounded-lg p-5 bg-white">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xl font-semibold">{formatDate(evt.date)}</div>
        <div className="text-sm text-gray-600">
          {formatTime(evt.checkInTime)} – {formatTime(evt.endTime)}
        </div>
      </div>
      <div className="mt-2 text-sm">
        <span className="font-medium">{pos.role}</span>
        {evt.venue ? <> at {evt.venue}</> : null}
        {evt.city ? <>, {evt.city}</> : null}
      </div>
      <div className="mt-2 text-sm text-gray-700">
        Estimated pay: <strong>${estPay.toFixed(2)}</strong>
        {inv.isOnCall ? " (on-call)" : null}
      </div>
      {evt.staffNotes && (
        <div className="mt-3 text-sm text-gray-600 border-t pt-3 whitespace-pre-wrap">
          {evt.staffNotes}
        </div>
      )}
    </div>
  );
}

function PendingInviteCard({ row }: { row: Row }) {
  const { inv, pos, evt, estPay } = row;
  return (
    <li className="border rounded-lg p-4 bg-yellow-50/60 border-yellow-200">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-semibold">{formatDate(evt.date)}</div>
        <div className="text-sm text-gray-600">
          {formatTime(evt.checkInTime)} – {formatTime(evt.endTime)}
        </div>
      </div>
      <div className="mt-1 text-sm">
        <span className="font-medium">{pos.role}</span>
        {evt.venue ? <> at {evt.venue}</> : null}
        {evt.city ? <>, {evt.city}</> : null}
        {inv.tier > 0 && <span className="ml-2 text-xs text-gray-500">(backup)</span>}
      </div>
      <div className="mt-1 text-sm text-gray-700">
        Pay: <strong>${estPay.toFixed(2)}</strong>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Link
          href={`/invite/${inv.token}/accept`}
          className="btn btn-primary text-sm"
          prefetch={false}
        >
          Accept
        </Link>
        <Link
          href={`/invite/${inv.token}/decline`}
          className="text-sm text-red-600 hover:underline"
          prefetch={false}
        >
          Decline
        </Link>
      </div>
    </li>
  );
}

function ConfirmedShiftRow({ row, isNext }: { row: Row; isNext: boolean }) {
  const { inv, pos, evt, estPay } = row;
  if (isNext) return null; // already shown in Next shift card
  return (
    <li className="border rounded-lg p-3 flex items-center justify-between gap-3 bg-white">
      <div>
        <div className="text-sm font-medium">{formatDate(evt.date)}</div>
        <div className="text-xs text-gray-600">
          {formatTime(evt.checkInTime)} – {formatTime(evt.endTime)} · {pos.role}
          {evt.venue ? ` · ${evt.venue}` : ""}
          {inv.isOnCall ? " · on-call" : ""}
        </div>
      </div>
      <div className="text-sm text-gray-700 shrink-0">${estPay.toFixed(2)}</div>
    </li>
  );
}
