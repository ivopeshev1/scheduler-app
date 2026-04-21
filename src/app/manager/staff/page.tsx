import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";

export default async function ManagerStaffPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));

  const rows = await db.select({ user: schema.users, profile: schema.staffProfiles })
    .from(schema.users)
    .leftJoin(schema.staffProfiles, eq(schema.users.id, schema.staffProfiles.userId))
    .where(eq(schema.users.companyId, session.companyId));
  const staffRows = rows.filter((r) => r.user.role === "staff");

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Staff</h1>
          <Link href="/manager/staff" className="btn btn-primary">+ Invite staff (coming soon)</Link>
        </div>

        <table className="w-full border-collapse">
          <thead className="text-xs text-gray-500 uppercase">
            <tr className="border-b">
              <th className="text-left py-2">Name</th>
              <th className="text-left">Position</th>
              <th className="text-left">Rate</th>
              <th className="text-left">City</th>
              <th className="text-left">Email</th>
              <th className="text-left">Phone</th>
            </tr>
          </thead>
          <tbody>
            {staffRows.map(({ user, profile }) => (
              <tr key={user.id} className="border-b">
                <td className="py-3">{profile ? `${profile.firstName} ${profile.lastName}` : <em className="text-gray-400">Not onboarded</em>}</td>
                <td className="py-3">{profile?.position ?? "—"}</td>
                <td className="py-3">{profile?.defaultRate ? `$${profile.defaultRate}${profile.defaultRateType === "hourly" ? "/hr" : ""}` : "—"}</td>
                <td className="py-3">{profile?.city ?? "—"}</td>
                <td className="py-3 text-sm text-gray-600">{user.email}</td>
                <td className="py-3 text-sm text-gray-600">{profile?.phone ?? "—"}</td>
              </tr>
            ))}
            {staffRows.length === 0 && (<tr><td colSpan={6} className="py-8 text-center text-gray-400">No staff yet.</td></tr>)}
          </tbody>
        </table>
      </main>
    </div>
  );
}
