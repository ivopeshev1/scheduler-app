import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, gte, lte } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { summarizePosition } from "@/lib/status";
import { formatTime } from "@/lib/format";

function parseMonth(m: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match) return null;
  const y = Number(match[1]); const mo = Number(match[2]);
  if (mo < 1 || mo > 12) return null;
  return { year: y, month: mo };
}
function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function MonthView({ params }: { params: { month: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const parsed = parseMonth(params.month);
  if (!parsed) notFound();

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!company || !user) redirect("/login");

  const startDate = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-01`;
  const endDate = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${daysInMonth(parsed.year, parsed.month)}`;
  const monthEvents = await db.select().from(schema.events).where(and(
    eq(schema.events.companyId, session.companyId),
    gte(schema.events.date, startDate),
    lte(schema.events.date, endDate),
  ));

  const byDay = new Map<string, typeof monthEvents>();
  for (const ev of monthEvents) {
    if (!byDay.has(ev.date)) byDay.set(ev.date, []);
    byDay.get(ev.date)!.push(ev);
  }

  const prevMonth = new Date(parsed.year, parsed.month - 2, 1);
  const nextMonth = new Date(parsed.year, parsed.month, 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = new Date(parsed.year, parsed.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const totalDays = daysInMonth(parsed.year, parsed.month);

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Link href={`/manager/month/${fmt(prevMonth)}`} className="btn btn-secondary">← Prev</Link>
          <h1 className="text-2xl font-semibold">{monthLabel}</h1>
          <Link href={`/manager/month/${fmt(nextMonth)}`} className="btn btn-secondary">Next →</Link>
        </div>

        <div className="space-y-6">
          {await Promise.all(Array.from({ length: totalDays }, async (_, i) => {
            const day = i + 1;
            const dateStr = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const events = byDay.get(dateStr) ?? [];
            const dow = new Date(parsed.year, parsed.month - 1, day).getDay();
            return <DayRow key={dateStr} day={day} weekday={WEEKDAY[dow]} dateStr={dateStr} events={events} />;
          }))}
        </div>
      </main>
    </div>
  );
}

async function DayRow({ day, weekday, dateStr, events }: {
  day: number; weekday: string; dateStr: string;
  events: Array<typeof schema.events.$inferSelect>;
}) {
  return (
    <div className="flex gap-4 border-t pt-4">
      <div className="w-32 flex-shrink-0">
        <div className="text-2xl font-semibold">{day}</div>
        <div className="text-sm text-gray-500 uppercase tracking-wide">{weekday}</div>
      </div>
      <div className="flex-1 grid md:grid-cols-2 gap-4">
        {await Promise.all(events.map((ev) => EventCard({ event: ev })))}
        <Link
          href={`/manager/event/new?date=${dateStr}`}
          className="border border-dashed rounded-lg p-4 text-gray-400 text-sm hover:border-gray-400 hover:text-gray-600 flex items-center justify-center min-h-[96px]"
        >
          {events.length === 0 ? "+ Add event for this day" : "+ Add another event"}
        </Link>
      </div>
    </div>
  );
}

async function EventCard({ event }: { event: typeof schema.events.$inferSelect }) {
  const positionsList = await db.select().from(schema.positions).where(eq(schema.positions.eventId, event.id));
  const statuses = await Promise.all(positionsList.map((p) => summarizePosition(p.id)));

  return (
    <Link key={event.id} href={`/manager/event/${event.id}`} className="border rounded-lg p-4 hover:border-gray-400 bg-white block">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold">{event.clientName}</div>
          <div className="text-sm text-gray-600">
            {event.eventType}
            {event.city ? ` · ${event.city}` : ""}
            {event.guestCount ? ` · ${event.guestCount} guests` : ""}
          </div>
        </div>
        <div className="text-sm text-gray-500">
          {event.checkInTime ? formatTime(event.checkInTime) : ""}
          {event.endTime ? ` – ${formatTime(event.endTime)}` : ""}
        </div>
      </div>
      <table className="w-full mt-3 text-sm">
        <thead className="text-xs text-gray-500 uppercase">
          <tr><th className="text-left w-8">#</th><th className="text-left">Position</th><th className="text-left">Staff / Status</th></tr>
        </thead>
        <tbody>
          {positionsList.map((p, i) => {
            const s = statuses[i];
            return (
              <tr key={p.id} className="border-t">
                <td className="py-1">{p.needed}</td>
                <td className="py-1 font-medium">{p.role}</td>
                <td className={`py-1 ${s.state === "pending" ? "status-pending" : "status-confirmed"}`}>{s.label}</td>
              </tr>
            );
          })}
          {positionsList.length === 0 && (<tr><td colSpan={3} className="py-2 text-gray-400 italic">No positions defined yet</td></tr>)}
        </tbody>
      </table>
    </Link>
  );
}
