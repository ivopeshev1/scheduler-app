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
export default async function StaffHomePage({ searchParams }: { searchParams: { welcome?: string; cancelled?: string } }) {
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
    const hours = hoursBetween(evt.checkInTime, evt.endTime);
    const estPay = shiftPay({
      rate: resolved.rate,
      rateType: resolved.rateType,
      hours,
      isOnCall: !!inv.isOnCall,
    });
    rows.push({ inv, pos, evt, estPay, rate: resolved.rate, rateType: resolved.rateType, hours });
  }

  // Sort by date (then start-of-day for stability). Next shift is the first
  // accepted row chronologically.
  rows.sort((a, b) => (a.evt.date === b.evt.date ? (a.evt.checkInTime ?? "").localeCompare(b.evt.checkInTime ?? "") : a.evt.date.localeCompare(b.evt.date)));
  const pending = rows.filter((r) => r.inv.status === "pending");
  const confirmed = rows.filter((r) => r.inv.status === "accepted");
  const nextShift = confirmed[0] ?? null;

  const showWelcome = searchParams.welcome === "1";
  const showCancelled = searchParams.cancelled === "1";

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" logoUrl={company.logoUrl} />
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {showWelcome && (
          <div className="border border-green-300 bg-green-50 rounded p-4 text-sm text-green-900">
            Welcome aboard, {profile?.firstName ?? "there"}! Your account is set up. Your manager can start sending you shift invites now.
          </div>
        )}
        {showCancelled && (
          <div className="border border-amber-300 bg-amber-50 rounded p-4 text-sm text-amber-900">
            Shift cancelled. Your manager has been notified.
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

        <section>
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
            Pending invitations{pending.length > 0 ? ` (${pending.length})` : ""}
          </h2>
          {pending.length > 0 ? (
            <ul className="space-y-3">
              {pending.map((r) => (
                <PendingInviteCard key={r.inv.id} row={r} />
              ))}
            </ul>
          ) : (
            <div className="border rounded-lg p-6 text-center text-gray-500 text-sm">
              No open invitations right now. When your manager sends you a shift, it&apos;ll show up here.
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
            Upcoming confirmed shifts{confirmed.length > 0 ? ` (${confirmed.length})` : ""}
          </h2>
          {confirmed.length > 0 ? (
            <ul className="space-y-2">
              {confirmed.map((r) => (
                <ConfirmedShiftRow key={r.inv.id} row={r} isNext={r === nextShift} />
              ))}
            </ul>
          ) : (
            <div className="border rounded-lg p-6 text-center text-gray-500 text-sm">
              Nothing confirmed yet. Shifts you accept will land here.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

type Row = {
  inv: typeof schema.invitations.$inferSelect;
  pos: typeof schema.positions.$inferSelect;
  evt: typeof schema.events.$inferSelect;
  estPay: number;
  rate: number;
  rateType: "hourly" | "flat";
  hours: number;
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

function formatRate(rate: number, type: "hourly" | "flat"): string {
  return type === "hourly" ? `$${rate.toFixed(2)}/hr` : `$${rate.toFixed(2)} flat`;
}

function formatHours(h: number): string {
  if (h <= 0) return "–";
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  if (minutes === 0) return `${whole}h`;
  return `${whole}h ${minutes}m`;
}

function NextShiftCard({ row }: { row: Row }) {
  const { inv, pos, evt, rate, rateType, hours } = row;
  const beoStatus = inv.beoReceivedAt
    ? { label: "BEO received", tone: "ok" as const }
    : inv.beoSentAt
    ? { label: "BEO sent — not yet acknowledged", tone: "warn" as const }
    : { label: "BEO not sent yet", tone: "muted" as const };
  return (
    <Link href={`/staff/shift/${inv.id}`} className="block border-2 border-black rounded-lg p-5 bg-white hover:bg-gray-50 transition-colors">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xl font-semibold">{formatDate(evt.date)}</div>
        <div className="text-sm text-gray-600">
          <span className="font-medium">{pos.role}</span>
          {inv.isOnCall ? " · on-call" : null}
        </div>
      </div>
      {(evt.venue || evt.city) && (
        <div className="mt-1 text-sm text-gray-700">
          {evt.venue ?? ""}{evt.venue && evt.city ? ", " : ""}{evt.city ?? ""}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <DetailRow label="Check in" value={formatTime(evt.checkInTime) || "–"} />
        <DetailRow label="Event start" value={formatTime(evt.eventStartTime) || "–"} />
        <DetailRow label="End" value={formatTime(evt.endTime) || "–"} />
        <DetailRow label="Hours" value={formatHours(hours)} />
        <DetailRow label="Rate" value={formatRate(rate, rateType)} />
        <DetailRow
          label="BEO"
          value={
            <span
              className={
                beoStatus.tone === "ok"
                  ? "text-green-700 font-medium"
                  : beoStatus.tone === "warn"
                  ? "text-amber-700 font-medium"
                  : "text-gray-500"
              }
            >
              {beoStatus.label}
            </span>
          }
        />
      </dl>

      {evt.staffNotes && (
        <div className="mt-4 text-sm text-gray-600 border-t pt-3 whitespace-pre-wrap">
          {evt.staffNotes}
        </div>
      )}
      <div className="mt-3 text-xs text-gray-500">Click for full details, roster, and cancel option →</div>
    </Link>
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
  const { inv, pos, evt, rate, rateType } = row;
  if (isNext) return null; // already shown in Next shift card
  return (
    <li>
      <Link
        href={`/staff/shift/${inv.id}`}
        className="border rounded-lg p-3 flex items-center justify-between gap-3 bg-white hover:bg-gray-50 transition-colors"
      >
        <div>
          <div className="text-sm font-medium">{formatDate(evt.date)}</div>
          <div className="text-xs text-gray-600">
            {formatTime(evt.checkInTime)} – {formatTime(evt.endTime)} · {pos.role}
            {evt.venue ? ` · ${evt.venue}` : ""}
            {inv.isOnCall ? " · on-call" : ""}
          </div>
        </div>
        <div className="text-sm text-gray-700 shrink-0">{formatRate(rate, rateType)}</div>
      </Link>
    </li>
  );
}
