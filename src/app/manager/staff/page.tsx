import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, makeInviteToken } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, isNull } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, greeting, paragraph, signoff } from "@/lib/email-html";
import { RemoveStaffMemberButton } from "@/components/RemoveStaffMemberButton";

async function archiveStaffAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const userId = String(formData.get("userId"));

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId || target.role !== "staff") throw new Error("Not found");

  // Refuse if they have any accepted shifts - manager must unwind those first via Edit Event
  const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.userId, userId));
  const hasAccepted = invites.some((i) => i.status === "accepted");
  if (hasAccepted) {
    throw new Error(
      `Cannot remove: this staff member has accepted shifts. Remove them from those shifts first via Edit Event.`
    );
  }

  // Silently cancel any pending invitations (no emails - same-day they might have gotten an
  // invite but if we're archiving them, they're no longer part of the roster).
  // Hard-deleting would trip the notifications.related_invitation_id FK, so
  // null that FK first on any notification that pointed at the invite we're
  // about to drop, then delete.
  for (const inv of invites) {
    if (inv.status === "pending") {
      await db
        .update(schema.notifications)
        .set({ relatedInvitationId: null })
        .where(eq(schema.notifications.relatedInvitationId, inv.id));
      await db.delete(schema.invitations).where(eq(schema.invitations.id, inv.id));
    }
  }

  await db.update(schema.users).set({ archivedAt: new Date() }).where(eq(schema.users.id, userId));
  // Notify them so they know why they can't log in anymore. Same email
  // path the manager-side account change uses, just for staff.
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const companyName = company?.name ?? "Scheduler";
  await sendEmail({
    to: target.email,
    subject: `Your ${companyName} account was removed`,
    body: `Hi,\n\nYour ${companyName} staff account has been removed. You can no longer log in.\n\nIf you believe this is a mistake, reach out to your manager at ${companyName} directly.\n\n– ${companyName}`,
    html: shellWrap([
      greeting(null, `Your ${companyName} staff account has been removed. You can no longer log in.`),
      paragraph(`If you believe this is a mistake, reach out to your manager at ${companyName} directly.`, { muted: true }),
      signoff(companyName),
    ].join("\n")),
    companyId: session.companyId,
  });
  revalidatePath("/manager/staff");
}

async function resendInviteAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const userId = String(formData.get("userId"));

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId) throw new Error("Not found");
  if (target.inviteAcceptedAt) throw new Error("Staff already onboarded - nothing to resend");

  // Generate a new token, invalidating any prior link, and re-send the
  // welcome email with the fresh URL. Manager also sees it on the Staff
  // page as a fallback if the email doesn't land.
  const newToken = makeInviteToken();
  await db.update(schema.users).set({ inviteToken: newToken }).where(eq(schema.users.id, userId));
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const companyName = company?.name ?? "Scheduler";
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const inviteUrl = `${proto}://${host}/invite/${newToken}`;
  await sendEmail({
    to: target.email,
    companyId: session.companyId,
    userId,
    subject: `Welcome to ${companyName} - finish setting up your account`,
    body:
      `Hi ${profile?.firstName ?? "there"},\n\n` +
      `Here's a fresh link to finish setting up your ${companyName} account:\n\n` +
      `${inviteUrl}\n\n` +
      `This link is personal to you - don't share it.\n\n` +
      `- ${companyName}`,
    html: shellWrap(
      [
        greeting(profile?.firstName ?? null, `Here's a fresh link to finish setting up your ${companyName} account.`),
        `<p style="margin:0 0 20px;"><a href="${inviteUrl}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Finish setting up my account</a></p>`,
        paragraph(`Or paste this link into your browser: ${inviteUrl}`, { muted: true }),
        paragraph(`This link is personal to you — please don't share it.`, { muted: true }),
        signoff(companyName),
      ].join("\n"),
    ),
  });
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
  // Per-staff role list for the Position / Rate columns.
  const allRoles = await db.select().from(schema.staffRoles);
  const rolesByUser = new Map<string, Array<{ role: string; rate: number; rateType: "hourly" | "flat" }>>();
  for (const r of allRoles) {
    const list = rolesByUser.get(r.userId) ?? [];
    list.push({ role: r.role, rate: r.rate, rateType: r.rateType as "hourly" | "flat" });
    rolesByUser.set(r.userId, list);
  }
  // Pre-compute accepted-shift counts so the Remove button can show a
  // friendly modal explaining why the staffer is still booked, instead
  // of the server action throwing a stack-trace-looking error.
  const allInvites = await db.select().from(schema.invitations);
  const acceptedByUser = new Map<string, number>();
  for (const inv of allInvites) {
    if (inv.status === "accepted") {
      acceptedByUser.set(inv.userId, (acceptedByUser.get(inv.userId) ?? 0) + 1);
    }
  }
  staffRows.sort((a, b) => {
    const aName = a.profile?.firstName ?? a.user.email;
    const bName = b.profile?.firstName ?? b.user.email;
    return aName.localeCompare(bName);
  });

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Staff ({staffRows.length})</h1>
          <div className="flex items-center gap-3">
            <Link href="/manager/staff/compare" className="btn btn-secondary">Compare &amp; rank</Link>
            <Link href="/manager/staff/new" className="btn btn-primary">+ Add staff</Link>
          </div>
        </div>

        <table className="w-full border-collapse">
          <thead className="text-xs text-gray-500 uppercase">
            <tr className="border-b">
              <th className="text-left py-2">Name</th>
              <th className="text-left">Position</th>
              <th className="text-left">Rate</th>
              <th className="text-left">City</th>
              <th className="text-left">Phone</th>
              <th className="text-left">Status</th>
              <th className="text-left"></th>
            </tr>
          </thead>
          <tbody>
            {staffRows.map(({ user, profile }) => {
              const pendingOnboarding = !!user.inviteToken && !user.inviteAcceptedAt;
              return (
                <tr key={user.id} className="border-b">
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <StaffAvatar firstName={profile?.firstName} lastName={profile?.lastName} email={user.email} />
                      <div>
                        {profile ? (
                          <>
                            <div className="font-medium">{profile.firstName} {profile.lastName}</div>
                            <div className="text-xs text-gray-500">{user.email}</div>
                          </>
                        ) : (
                          <em className="text-gray-400">{user.email}</em>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    {(rolesByUser.get(user.id) ?? []).length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {rolesByUser.get(user.id)!.map((r) => (
                          <div key={r.role} className="text-sm">{r.role}</div>
                        ))}
                      </div>
                    ) : (
                      profile?.position ?? "-"
                    )}
                  </td>
                  <td className="py-3">
                    {(rolesByUser.get(user.id) ?? []).length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {rolesByUser.get(user.id)!.map((r) => (
                          <div key={r.role} className="text-sm">
                            ${r.rate}{r.rateType === "hourly" ? "/hr" : " flat"}
                          </div>
                        ))}
                      </div>
                    ) : profile?.defaultRate ? (
                      `$${profile.defaultRate}${profile.defaultRateType === "hourly" ? "/hr" : profile.defaultRateType === "flat" ? " flat" : ""}`
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="py-3">{profile?.city ?? <span className="text-gray-300">-</span>}</td>
                  <td className="py-3 text-sm text-gray-600">{profile?.phone ?? <span className="text-gray-300">-</span>}</td>
                  <td className="py-3 text-sm">
                    {user.inviteAcceptedAt ? (
                      <span className="text-status-confirmed">Onboarded</span>
                    ) : pendingOnboarding ? (
                      <PendingOnboardingCell userId={user.id} />
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex gap-3 justify-end items-center">
                      <Link
                        href={`/manager/staff/${user.id}`}
                        className="text-sm underline text-gray-600 hover:text-black"
                      >
                        Log
                      </Link>
                      {profile && (
                        <Link
                          href={`/manager/staff/${user.id}/edit`}
                          className="text-sm underline text-gray-600 hover:text-black"
                        >
                          Modify
                        </Link>
                      )}
                      <RemoveStaffMemberButton
                        userId={user.id}
                        staffName={profile ? `${profile.firstName} ${profile.lastName}` : user.email}
                        acceptedShifts={acceptedByUser.get(user.id) ?? 0}
                        action={archiveStaffAction}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {staffRows.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">No staff yet. Click &quot;+ Add staff&quot; to start.</td></tr>
            )}
          </tbody>
        </table>
      </main>
    </div>
  );
}

/**
 * Circular avatar for a staff row. For now shows the staffer's initials
 * on a soft colored background derived from their name - gives each
 * person a stable, distinct look at a glance. When upload-your-photo
 * ships during onboarding, swap in <img src={profile.photoUrl}>.
 */
function StaffAvatar({ firstName, lastName, email }: { firstName?: string | null; lastName?: string | null; email: string }) {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  const initials = (
    (first[0] ?? "") + (last[0] ?? "")
  ).toUpperCase() || email[0]?.toUpperCase() || "?";
  // Pick a consistent hue per person so the same user always gets the
  // same color across page loads.
  const seed = (first + last + email).toLowerCase();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const style: React.CSSProperties = {
    background: `hsl(${hue}, 55%, 85%)`,
    color: `hsl(${hue}, 45%, 25%)`,
  };
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm shrink-0"
      style={style}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function PendingOnboardingCell({ userId }: { userId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="status-pending text-xs">Pending onboarding</span>
      <form action={resendInviteAction}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          className="text-xs text-gray-600 underline hover:text-black"
          title="Email them a fresh invite link (the old one stops working)"
        >
          Resend invite
        </button>
      </form>
    </div>
  );
}
