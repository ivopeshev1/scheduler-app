import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";

/**
 * Manager-facing audit log of every email the app has dispatched (or tried to).
 * Useful when staff say "I never got your email" — check here for delivery
 * status before re-sending. Shows newest first, capped at 200 to keep the
 * query bounded; proper pagination can come later if needed.
 */
export default async function LogPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  if (!user.isOwner && !user.canAccessLog) redirect("/manager?denied=log");

  const rowsRaw = await db
    .select({
      notif: schema.notifications,
      user: schema.users,
      profile: schema.staffProfiles,
    })
    .from(schema.notifications)
    .leftJoin(schema.users, eq(schema.notifications.userId, schema.users.id))
    .leftJoin(schema.staffProfiles, eq(schema.notifications.userId, schema.staffProfiles.userId))
    .where(eq(schema.notifications.companyId, session.companyId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(200);

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Log</h1>
        <p className="text-sm text-gray-600 mb-6">
          Every email the app has dispatched, newest first. Check here to confirm a staff member was notified
          (or to debug when someone says they didn&apos;t receive something).
        </p>

        {rowsRaw.length === 0 ? (
          <div className="border rounded-lg p-8 text-center text-gray-400 bg-white">
            Nothing logged yet. Entries will appear here as you send invites, cancel events, etc.
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr className="border-b">
                  <th className="text-left px-4 py-2">When</th>
                  <th className="text-left px-4 py-2">Recipient</th>
                  <th className="text-left px-4 py-2">Subject</th>
                  <th className="text-left px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rowsRaw.map(({ notif, user: recipient, profile }) => {
                  const when = notif.createdAt instanceof Date
                    ? notif.createdAt
                    : new Date(notif.createdAt as any);
                  const whenLabel = when.toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  });
                  const fullName = profile ? `${profile.firstName} ${profile.lastName}` : null;
                  return (
                    <tr key={notif.id} className="border-b last:border-b-0 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{whenLabel}</td>
                      <td className="px-4 py-2">
                        {fullName ? (
                          <div>
                            <div>{fullName}</div>
                            <div className="text-xs text-gray-500">{recipient?.email ?? "—"}</div>
                          </div>
                        ) : (
                          <span className="text-gray-500">{recipient?.email ?? "system"}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {notif.subject ?? <span className="text-gray-400 italic">(no subject)</span>}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={notif.status} errorMessage={notif.errorMessage} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rowsRaw.length >= 200 && (
          <p className="text-xs text-gray-500 mt-3">
            Showing the most recent 200 entries.
          </p>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status, errorMessage }: { status: string; errorMessage: string | null }) {
  const tone =
    status === "sent" ? "bg-green-50 text-green-700 border-green-200"
    : status === "failed" ? "bg-red-50 text-red-700 border-red-200"
    : status === "dev-logged" ? "bg-gray-100 text-gray-600 border-gray-200"
    : "bg-yellow-50 text-yellow-700 border-yellow-200";
  const label =
    status === "sent" ? "Sent"
    : status === "failed" ? "Failed"
    : status === "dev-logged" ? "Dev-logged"
    : status === "queued" ? "Queued"
    : status;
  return (
    <div>
      <span className={`inline-block text-xs px-2 py-0.5 border rounded ${tone}`}>{label}</span>
      {status === "failed" && errorMessage && (
        <div className="text-xs text-red-600 mt-1 max-w-xs truncate" title={errorMessage}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}
