import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, gte, lte } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { formatTime } from "@/lib/format";

/**
 * Month-grid ("overlook") view of the calendar - seven columns Sun→Sat, six
 * rows to cover every layout. Complement to the list view at /manager/month,
 * which stays around for drilling into a single day. Each cell shows the day
 * number plus compact event chips; click a chip to open that event, click the
 * empty area to add a new event on that day.
 */
function parseMonth(m: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  if (mo < 1 || mo > 12) return null;
  return { year: y, month: mo };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayYMD() {
  return toYMD(new Date());
}

export default async function CalendarGridView({ params }: { params: { month: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const parsed = parseMonth(params.month);
  if (!parsed) notFound();

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!company || !user) redirect("/login");
  if (!user.isOwner && !user.canAccessCalendar) redirect("/manager?denied=calendar");

  // Roll the grid back to the Sunday on or before the 1st of the month, then
  // extend 42 days (six weeks) so every possible month layout fits without
  // scrolling surprises.
  const firstOfMonth = new Date(parsed.year, parsed.month - 1, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);

  const monthEvents = await db.select().from(schema.events).where(and(
    eq(schema.events.companyId, session.companyId),
    gte(schema.events.date, toYMD(gridStart)),
    lte(schema.events.date, toYMD(gridEnd)),
  ));

  // Bucket events by date so each cell only walks its own list.
  const byDay = new Map<string, typeof monthEvents>();
  for (const ev of monthEvents) {
    if (!byDay.has(ev.date)) byDay.set(ev.date, []);
    byDay.get(ev.date)!.push(ev);
  }
  // Sort each day's events by check-in time so earlier shifts show up top.
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.checkInTime ?? "").localeCompare(b.checkInTime ?? ""));
  }

  const prevMonth = new Date(parsed.year, parsed.month - 2, 1);
  const nextMonth = new Date(parsed.year, parsed.month, 1);
  const fmtMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = new Date(parsed.year, parsed.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const today = todayYMD();
  const nowMonth = fmtMonth(new Date());

  // Build the 42 cells once so the render loop stays flat.
  const cells: { date: Date; ymd: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({
      date: d,
      ymd: toYMD(d),
      inMonth: d.getMonth() === parsed.month - 1 && d.getFullYear() === parsed.year,
    });
  }

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <Link href={`/manager/calendar/${fmtMonth(prevMonth)}`} className="btn btn-secondary">← Prev</Link>
          <h1 className="text-2xl font-semibold">{monthLabel}</h1>
          <Link href={`/manager/calendar/${fmtMonth(nextMonth)}`} className="btn btn-secondary">Next →</Link>
          {params.month !== nowMonth && (
            <Link href={`/manager/calendar/${nowMonth}`} className="text-sm text-gray-600 hover:underline">
              Today
            </Link>
          )}
          <div className="ml-auto inline-flex rounded border text-sm overflow-hidden">
            <span className="px-3 py-1 bg-gray-900 text-white">Grid</span>
            <Link href={`/manager/month/${params.month}`} className="px-3 py-1 hover:bg-gray-100 text-gray-700">List</Link>
          </div>
        </div>

        <div className="grid grid-cols-7 border-l border-t bg-white text-sm">
          {WEEKDAYS.map((w) => (
            <div key={w} className="border-r border-b bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {w}
            </div>
          ))}
          {cells.map(({ date, ymd, inMonth }) => {
            const events = byDay.get(ymd) ?? [];
            const isToday = ymd === today;
            return (
              <div
                key={ymd}
                className={`border-r border-b min-h-[112px] relative flex flex-col ${
                  inMonth ? "bg-white" : "bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between px-1.5 pt-1">
                  <span
                    className={
                      isToday
                        ? "inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-semibold"
                        : `text-xs font-semibold ${inMonth ? "text-gray-700" : "text-gray-400"}`
                    }
                  >
                    {date.getDate()}
                  </span>
                  <Link
                    href={`/manager/event/new?date=${ymd}`}
                    className="text-gray-300 hover:text-gray-700 text-sm leading-none px-1"
                    aria-label={`Add event on ${ymd}`}
                    title="Add event"
                  >
                    +
                  </Link>
                </div>
                <div className="px-1 pb-1 pt-0.5 flex flex-col gap-0.5">
                  {events.slice(0, 3).map((ev) => (
                    <Link
                      key={ev.id}
                      href={`/manager/event/${ev.id}`}
                      className={`block text-xs leading-tight px-1.5 py-0.5 rounded truncate ${
                        ev.cancelledAt
                          ? "bg-red-50 text-red-700 line-through border border-red-200"
                          : "bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-100"
                      }`}
                      title={`${ev.clientName}${ev.checkInTime ? ` · ${formatTime(ev.checkInTime)}` : ""}${ev.city ? ` · ${ev.city}` : ""}`}
                    >
                      {ev.checkInTime && (
                        <span className="text-[10px] text-gray-500 mr-1">
                          {formatTime(ev.checkInTime).replace(":00 ", "").replace(" ", "")}
                        </span>
                      )}
                      {ev.clientName}
                    </Link>
                  ))}
                  {events.length > 3 && (
                    <Link
                      href={`/manager/month/${params.month}#day-${ymd}`}
                      className="text-[11px] text-gray-500 hover:text-gray-800 px-1.5"
                    >
                      +{events.length - 3} more
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
