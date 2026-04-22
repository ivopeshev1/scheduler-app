import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { headers } from "next/headers";

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
  staffRows.sort((a, b) => {
    const aName = a.profile?.firstName ?? a.user.email;
    const bName = b.profile?.firstName ?? b.user.email;
    return aName.localeCompare(bName);
  });

  // Build base URL for invite links from request headers
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = `${proto}://${host}`;

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Staff ({staffRows.length})</h1>
          <Link href="/manager/staff/new" className="btn btn-primary">+ Add staff</Link>
        </div>

        <table className="w-full border-collapse">
          <thead className="text-xs text-gray-500 uppercase">
            <tr className="border-b">
              <th className="text-left py-2">Name</th>
              <th className="text-left">Position</th>
              <th className="text-left">Rate</th>
              <th className="text-left">City</th>
              <th className="text-left">Phone</th>
              <th className="text-left">Van?</th>
              <th className="text-left">Status</th>
              <th className="text-left"></th>
            </tr>
          </thead>
          <tbody>
            {staffRows.map(({ user, profile }) => {
              const inviteUrl = user.inviteToken && !user.inviteAcceptedAt
                ? `${baseUrl}/invite/${user.inviteToken}`
                : null;
              return (
                <tr key={user.id} className="border-b">
                  <td className="py-3">
                    {profile ? (
                      <>
                        <div className="font-medium">{profile.firstName} {profile.lastName}</div>
                        <div className="text-xs text-gray-500">{user.email}</div>
                      </>
                    ) : (
                      <em className="text-gray-400">{user.email}</em>
                    )}
                  </td>
                  <td className="py-3">{profile?.position ?? "—"}</td>
                  <td className="py-3">
                    {profile?.defaultRate
                      ? `$${profile.defaultRate}${profile.defaultRateType === "hourly" ? "/hr" : profile.defaultRateType === "flat" ? " flat" : ""}`
                      : "—"}
                  </td>
                  <td className="py-3">{profile?.city ?? <span className="text-gray-300">—</span>}</td>
                  <td className="py-3 text-sm text-gray-600">{profile?.phone ?? <span className="text-gray-300">—</span>}</td>
                  <td className="py-3 text-sm">
                    {profile?.canDriveVan ? "✓" : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 text-sm">
                    {user.inviteAcceptedAt ? (
                      <span className="text-status-confirmed">Onboarded</span>
                    ) : inviteUrl ? (
                      <InviteLinkCell url={inviteUrl} />
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    {profile && (
                      <Link
                        href={`/manager/staff/${user.id}/edit`}
                        className="text-sm underline text-gray-600 hover:text-black"
                      >
                        Modify
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {staffRows.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">No staff yet. Click "+ Add staff" to start.</td></tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}

function InviteLinkCell({ url }: { url: string }) {
  return (
    <div className="flex flex-col">
      <span className="status-pending text-xs">Pending onboarding</span>
      <details className="mt-1">
        <summary className="text-xs text-gray-500 cursor-pointer underline">Invite link</summary>
        <div className="mt-1 p-2 bg-gray-50 border rounded text-xs break-all font-mono">
          {url}
        </div>
        <p className="text-xs text-gray-500 mt-1">Copy and email this to the staff member.</p>
      </details>
    </div>
  );
}
