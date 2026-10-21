import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { parseMonthSlug, monthSlug, shiftMonth, buildMonthGrid, monthLabel } from "@/lib/month-grid";
import { nanoid } from "nanoid";
import { formatTime } from "@/lib/format";
import { describeBlock } from "@/lib/availability-blocks";
import { BlockDayButton } from "./BlockDayButton";

/**
 * Staff calendar — month grid of the staffer's own confirmed shifts, plus
 * the ability to mark any date as "unavailable" so the manager-side picker
 * excludes them from invites for that day. The URL carries the month slug
 * (YYYY-MM) so Prev / Next navigate cleanly and the back button works.
 *
 * Design: Google-Calendar-style 6x7 grid, Sunday-first. Each cell shows
 * (a) the shift chips (role at venue, time range) stacked, and (b) a
 * block / unblock button. Blocked days get a muted red tint.
 */

async function addBlockAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const date = String(formData.get("date") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Bad date");
  const mode = String(formData.get("mode") ?? "all");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  let startTime: string | null = null;
  let endTime: string | null = null;
  if (mode === "range") {
    const s = String(formData.get("startTime") ?? "").trim();
    const e = String(formData.get("endTime") ?? "").trim();
    if (!/^\d{1,2}:\d{2}$/.test(s) || !/^\d{1,2}:\d{2}$/.test(e)) throw new Error("Bad time range");
    startTime = s;
    endTime = e;
  }
  await db.insert(schema.availabilityBlocks).values({
    id: nanoid(),
    userId: session.userId,
    date,
    startTime,
    endTime,
    reason,
  });
  revalidatePath(`/staff/calendar/${month}`);
  redirect(`/staff/calendar/${month}`);
}

async function removeBlockAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const month = String(formData.get("month") ?? "").trim();
  const blockId = String(formData.get("blockId") ?? "").trim();
  if (!blockId) throw new Error("Bad block id");
  const [b] = await db.select().from(schema.availabilityBlocks).where(eq(schema.availabilityBlocks.id, blockId));
  if (!b || b.userId !== session.userId) throw new Error("Not found");
  await db.delete(schema.availabilityBlocks).where(eq(schema.availabilityBlocks.id, blockId));
  revalidatePath(`/staff/calendar/${month}`);
  redirect(`/staff/calendar/${month}`);
}

export default async function StaffMonthPage({ params }: { params: { month: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "staff") redirect("/manager");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");

  const { year, month } = parseMonthSlug(params.month);
  const grid = buildMonthGrid(year, month);
  const monthStart = grid.find((c) => c.inMonth)!.iso;
  const monthEnd = [...grid].reverse().find((c) => c.inMonth)!.iso;
  const todayIso = new Date().toISOString().slice(0, 10);

  // Accepted shifts this user has for any date on the visible grid (incl.
  // the padding days from the neighbor months, so neighbor-month shifts
  // show up in the gray cells too).
  const gridStart = grid[0].iso;
  const gridEnd = grid[grid.length - 1].iso;
  const invitations = await db
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.userId, session.userId),
        inArray(schema.invitations.status, ["accepted"]),
        isNull(schema.invitations.cancelledAt),
      ),
    );
  const posIds = Array.from(new Set(invitations.map((i) => i.positionId)));
  const positionsList = posIds.length
    ? await db.select().from(schema.positions).where(inArray(schema.positions.id, posIds))
    : [];
  const evtIds = Array.from(new Set(positionsList.map((p) => p.eventId)));
  const eventsList = evtIds.length
    ? await db.select().from(schema.events).where(inArray(schema.events.id, evtIds))
    : [];
  const posById = new Map(positionsList.map((p) => [p.id, p]));
  const evtById = new Map(eventsList.map((e) => [e.id, e]));

  type DayShift = { role: string; venue: string | null; checkIn: string | null; endTime: string | null; isOnCall: boolean };
  const shiftsByDate = new Map<string, DayShift[]>();
  for (const inv of invitations) {
    const pos = posById.get(inv.positionId);
    if (!pos) continue;
    const evt = evtById.get(pos.eventId);
    if (!evt || evt.cancelledAt) continue;
    if (evt.date < gridStart || evt.date > gridEnd) continue;
    const list = shiftsByDate.get(evt.date) ?? [];
    list.push({ role: pos.role, venue: evt.venue, checkIn: evt.checkInTime, endTime: evt.endTime, isOnCall: !!inv.isOnCall });
    shiftsByDate.set(evt.date, list);
  }

  // Blocks on the visible grid. Multiple partial blocks per date are
  // allowed, so bucket into a list per date for rendering.
  const blocks = await db
    .select()
    .from(schema.availabilityBlocks)
    .where(eq(schema.availabilityBlocks.userId, session.userId));
  const blocksByDate = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const list = blocksByDate.get(b.date) ?? [];
    list.push(b);
    blocksByDate.set(b.date, list);
  }

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" logoUrl={company.logoUrl} />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold">{monthLabel(year, month)}</h1>
            <div className="flex items-center gap-1">
              <Link href={`/staff/calendar/${monthSlug(prev.year, prev.month)}`} className="btn btn-secondary text-sm">← Prev</Link>
              <Link href={`/staff/calendar/${monthSlug(next.year, next.month)}`} className="btn btn-secondary text-sm">Next →</Link>
              {monthSlug(year, month) !== monthSlug(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1) && (
                <Link
                  href={`/staff/calendar/${monthSlug(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1)}`}
                  className="text-sm text-gray-600 hover:underline ml-2"
                >
                  Today
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-black inline-block" /> Shift
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-red-100 border border-red-300 inline-block" /> Unavailable
            </span>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Click <strong>Block</strong> on any day for a whole-day block or a time range (e.g. &ldquo;6pm – 11pm&rdquo;).
          Your manager won&apos;t be able to invite you to shifts that overlap. Click <strong>×</strong> next to a block to remove it.
        </p>

        {/* Weekday header */}
        <div className="grid grid-cols-7 text-xs uppercase text-gray-500 border-b pb-2 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2">{d}</div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200">
          {grid.map((cell) => {
            const shifts = shiftsByDate.get(cell.iso) ?? [];
            const dayBlocks = blocksByDate.get(cell.iso) ?? [];
            const isToday = cell.iso === todayIso;
            const past = cell.iso < todayIso;
            const hasWholeDayBlock = dayBlocks.some((b) => !b.startTime && !b.endTime);
            const bg = hasWholeDayBlock
              ? "bg-red-50"
              : dayBlocks.length > 0
              ? "bg-red-50/50"
              : cell.inMonth ? "bg-white" : "bg-gray-50";
            return (
              <div
                key={cell.iso}
                className={`min-h-[110px] p-2 ${bg} relative ${past ? "opacity-70" : ""}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-xs ${cell.inMonth ? "text-gray-700" : "text-gray-400"} ${isToday ? "font-bold text-black bg-yellow-200 rounded-full w-6 h-6 inline-flex items-center justify-center" : ""}`}
                  >
                    {cell.day}
                  </span>
                  {!past && cell.inMonth && shifts.length === 0 && !hasWholeDayBlock && (
                    <BlockDayButton
                      dateIso={cell.iso}
                      monthSlug={monthSlug(year, month)}
                      action={addBlockAction}
                    />
                  )}
                </div>
                {shifts.map((s, i) => (
                  <div
                    key={i}
                    className={`text-xs rounded px-1.5 py-0.5 mb-1 ${s.isOnCall ? "bg-gray-200 text-gray-800" : "bg-black text-white"}`}
                  >
                    <div className="font-medium truncate">
                      {s.role}{s.isOnCall ? " (on-call)" : ""}
                    </div>
                    {s.venue && <div className="truncate opacity-80">{s.venue}</div>}
                    {s.checkIn && (
                      <div className="opacity-80">{formatTime(s.checkIn)}{s.endTime ? `–${formatTime(s.endTime)}` : ""}</div>
                    )}
                  </div>
                ))}
                {dayBlocks.map((b) => (
                  <div key={b.id} className="text-xs text-red-700 mt-1 flex items-start justify-between gap-1">
                    <span className="font-medium">
                      {describeBlock(b)}
                      {b.reason ? <span className="font-normal opacity-80"> · {b.reason}</span> : null}
                    </span>
                    {!past && (
                      <form action={removeBlockAction} className="inline">
                        <input type="hidden" name="blockId" value={b.id} />
                        <input type="hidden" name="month" value={monthSlug(year, month)} />
                        <button
                          type="submit"
                          className="text-[10px] text-red-700 hover:underline shrink-0"
                          title="Remove this block"
                        >
                          ×
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
