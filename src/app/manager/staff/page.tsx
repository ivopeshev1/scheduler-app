import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, makeInviteToken } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, isNull } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

async function archiveStaffAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const userId = String(formData.get("userId"));

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId || target.role !== "staff") throw new Error("Not found");

  // Refuse if they have any accepted shifts — manager must unwind those first via Edit Event
  const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.userId, userId));
  const hasAccepted = invites.some((i) => i.status === "accepted");
  if (hasAccepted) {
    throw new Error(
      `Cannot remove: this staff member has accepted shifts. Remove them from those shifts first via Edit Event.`
    );
  }

  // Silently cancel any pending invitations (no emails — same-day they might have gotten an
  // invite but if we're archiving them, they're no longer part of the roster).
  for (const inv of invites) {
    if (inv.status === "pending") {
      await db.delete(schema.invitations).where(eq(schema.invitations.id, inv.id));
    }
  }

  await db.update(schema.users).set({ archivedAt: new Date() }).where(eq(schema.users.id, userId));
  revalidatePath("/manager/staff");
}

async function resendInviteAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const userId = String(formData.get("userId"));

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId) throw new Error("Not found");
  if (target.inviteAcceptedAt) throw new Error("Staff already onboarded — nothing to resend");

  // Generate a new token, invalidating any prior link. Manager copies the new
  // URL from the staff page and shares it however they want (email, text, etc).
  const newToken = makeInviteToken();
  await db.update(schema.users).set({ inviteToken: newToken }).where(eq(schema.users.id, userId));
  revalidatePath("/manager/staff");
}

export default async function ManagerStaffPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  if (!user.isOwner && !user.canAccessStaff) redirect("/manager?denied=staff");

  const rows = await db.select({ user: schema.users, profile: schema.staffProfiles })
    .from(schema.users)
    .leftJoin(schema.staffProfiles, eq(schema.users.id, schema.staffProfiles.userId))
    .where(and(eq(schema.users.companyId, session.companyId), isNull(schema.users.archivedAt)));
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
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
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
                      <InviteLinkCell url={inviteUrl} userId={user.id} />
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex gap-3 justify-end items-center">
                      {profile && (
                        <Link
                          href={`/manager/staff/${user.id}/edit`}
                          className="text-sm underline text-gray-600 hover:text-black"
                        >
                          Modify
                        </Link>
                      )}
                      <form action={archiveStaffAction}>
                        <input type="hidden" name="userId" value={user.id} />
                        <button
                          type="submit"
                          className="text-sm text-red-600 hover:underline"
                          title="Remove this staff member (soft-delete)"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {staffRows.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">No staff yet. Click &quot;+ Add staff&quot; to start.</td></tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}

function InviteLinkCell({ url, userId }: { url: string; userId: string }) {
  return (
    <div className="flex flex-col">
      <span className="status-pending text-xs">Pending onboarding</span>
      <details className="mt-1">
        <summary className="text-xs text-gray-500 cursor-pointer underline">Invite link</summary>
        <div className="mt-1 p-2 bg-gray-50 border rounded text-xs break-all font-mono">
          {url}
        </div>
        <p className="text-xs text-gray-500 mt-1">Copy and email this to the staff member.</p>
        <form action={resendInviteAction} className="mt-2">
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            className="text-xs text-gray-600 underline hover:text-black"
            title="Generate a fresh link (the old one stops working)"
          >
            Regenerate link
          </button>
        </form>
      </details>
    </div>
  );
}
