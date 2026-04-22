import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, or, ilike, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { formatDate, formatTime } from "@/lib/format";

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  const q = (searchParams.q ?? "").trim();

  let results: Array<typeof schema.events.$inferSelect> = [];
  if (q) {
    const likePattern = `%${q}%`;
    // Match against the most useful text fields + raw date. Drizzle's ilike does
    // case-insensitive substring match. For the date, we include literal match
    // so "2026-04" or "04-21" style queries hit.
    results = await db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.companyId, session.companyId),
          or(
            ilike(schema.events.clientName, likePattern),
            ilike(schema.events.venue, likePattern),
            ilike(schema.events.city, likePattern),
            ilike(schema.events.eventType, likePattern),
            ilike(schema.events.planner, likePattern),
            ilike(schema.events.date, likePattern),
          ),
        ),
      );
    // Sort by date ascending (upcoming first after today, then past)
    results.sort((a, b) => a.date.localeCompare(b.date));
  }

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6">
          {q ? `Search: "${q}"` : "Search events"}
        </h1>

        <form action="/manager/search" method="get" className="mb-6">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Client, venue, city, event type, planner, date (2026-04-15)…"
            className="input"
            autoFocus
          />
        </form>

        {!q ? (
          <p className="text-gray-500 text-sm">
            Type a keyword and hit Enter. Searches client name, venue, city, event type, planner, and date.
          </p>
        ) : results.length === 0 ? (
          <p className="text-gray-500 text-sm">No events match <strong>{q}</strong>.</p>
        ) : (
          <div className="divide-y border rounded-lg bg-white">
            {results.map((ev) => (
              <Link
                key={ev.id}
                href={`/manager/event/${ev.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50"
              >
                <div>
                  <div className={`font-medium ${ev.cancelledAt ? "line-through text-gray-400" : ""}`}>
                    {ev.clientName}
                    {ev.cancelledAt && <span className="ml-2 text-xs text-red-600 font-semibold">CANCELLED</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(ev.date)}
                    {ev.checkInTime ? ` · ${formatTime(ev.checkInTime)}` : ""}
                    {ev.venue ? ` · ${ev.venue}` : ""}
                    {ev.city ? `, ${ev.city}` : ""}
                    {ev.eventType ? ` · ${ev.eventType}` : ""}
                  </div>
                </div>
                <div className="text-xs text-gray-400">→</div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 text-sm">
          <Link href="/manager" className="text-gray-500 hover:underline">← Back to calendar</Link>
        </div>
      </main>
    </div>
  );
}
