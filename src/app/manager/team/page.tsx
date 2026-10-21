import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hashPassword, makeInviteToken } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { headers } from "next/headers";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, kvRow, kvTable, greeting, paragraph, signoff } from "@/lib/email-html";
import { canModifyManager, canAddManager } from "@/lib/permissions";

type AccessFlags = {
  canAccessCalendar: boolean;
  canAccessStaff: boolean;
  canAccessLog: boolean;
  canAccessPayroll: boolean;
  canAccessTeam: boolean;
  canEditSettings: boolean;
};

// Display labels for the scope-note in the welcome email, in nav order.
const ACCESS_LABELS: Record<keyof AccessFlags, string> = {
  canAccessCalendar: "Calendar",
  canAccessStaff: "Staff",
  canAccessLog: "Log",
  canAccessPayroll: "Payroll",
  canAccessTeam: "Admin",
  canEditSettings: "Settings",
};

function readAccessFlags(formData: FormData): AccessFlags {
  return {
    canAccessCalendar: formData.get("canAccessCalendar") === "on",
    canAccessStaff: formData.get("canAccessStaff") === "on",
    canAccessLog: formData.get("canAccessLog") === "on",
    canAccessPayroll: formData.get("canAccessPayroll") === "on",
    canAccessTeam: formData.get("canAccessTeam") === "on",
    canEditSettings: formData.get("canEditSettings") === "on",
  };
}

function accessSummary(flags: AccessFlags): string {
  const on = (Object.keys(ACCESS_LABELS) as (keyof AccessFlags)[])
    .filter((k) => flags[k])
    .map((k) => ACCESS_LABELS[k]);
  return on.length > 0 ? on.join(", ") : "no sections yet (the owner will need to grant access)";
}

/**
 * View-level gate: owner OR anyone with canAccessTeam can SEE the page.
 * Mutations are gated separately via requireOwner so a delegated manager
 * can look at the roster without being able to edit it.
 */
async function requireTeamAccess() {
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner && !me?.canAccessTeam) throw new Error("Forbidden: Admin access required");
  return { session, me };
}

/**
 * Mutation gate: only the company owner can add, edit, suspend, remove,
 * or reset-password another manager. Enforced server-side so a crafted
 * form submit from a non-owner manager still fails.
 */
async function requireOwner() {
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner) throw new Error("Forbidden: only the company owner can do this");
  return { session, me };
}

/**
 * Build + send the welcome email that tells a newly-added manager how to log in.
 * Includes their email, the starting password, a link to /login, and the list of
 * sections they have access to so they know what to expect.
 */
async function sendManagerInviteEmail({
  toEmail,
  firstName,
  companyId,
  companyName,
  inviteUrl,
  flags,
}: {
  toEmail: string;
  firstName: string;
  companyId: string;
  companyName: string;
  inviteUrl: string;
  flags: AccessFlags;
}) {
  const scopeNote = `Your access includes: ${accessSummary(flags)}.`;
  const textBody = [
    `Hi ${firstName},`, ``,
    `${companyName} added you as a manager on its scheduling app.`,
    `Open the link below to finish setting up your account — you'll pick your own password.`, ``,
    inviteUrl, ``,
    scopeNote, ``,
    `This link is personal to you - don't share it.`, ``,
    `– ${companyName}`,
  ].join("\n");

  const htmlBody = shellWrap([
    greeting(firstName, `${companyName} added you as a manager on its scheduling app.`),
    paragraph(`Click the button below to finish setting up your account. You'll pick your own password.`),
    `<p style="margin:12px 0 20px;"><a href="${inviteUrl}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Finish setting up my account</a></p>`,
    paragraph(`Or paste this link into your browser: ${inviteUrl}`, { muted: true }),
    paragraph(scopeNote, { muted: true }),
    paragraph(`This link is personal to you — please don't share it.`, { muted: true }),
    signoff(companyName),
  ].join("\n"));

  await sendEmail({
    to: toEmail,
    subject: `Welcome to ${companyName} - finish setting up your manager account`,
    body: textBody,
    html: htmlBody,
    companyId,
  });
}

async function addManagerAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const flags = readAccessFlags(formData);

  if (!firstName || !lastName || !email) {
    redirect("/manager/team?err=" + encodeURIComponent("First name, last name, and email are required."));
  }

  // Location assignment is required - gate early so we don't leave a
  // half-created user behind if the owner forgot a checkbox.
  const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);
  if (locationIds.length === 0) {
    redirect("/manager/team?err=" + encodeURIComponent("Pick at least one location for this manager."));
  }

  // Duplicate-email handling. Mirror the Add Staff flow: if there's an
  // archived prior row with the same email we resurrect it; an active
  // one bounces back with an inline error.
  const existing = await db.select().from(schema.users).where(
    and(eq(schema.users.companyId, session.companyId), eq(schema.users.email, email)),
  );
  const archivedPrior = existing.find((u) => u.archivedAt && u.role === "manager" && !u.isOwner);
  const activePrior = existing.find((u) => !u.archivedAt);
  if (activePrior) {
    redirect("/manager/team?err=" + encodeURIComponent(`A user with email ${email} already exists in your company.`));
  }

  const userId = archivedPrior ? archivedPrior.id : nanoid();
  const inviteToken = makeInviteToken();
  if (archivedPrior) {
    await db
      .update(schema.users)
      .set({
        archivedAt: null,
        suspendedAt: null,
        inviteToken,
        inviteAcceptedAt: null,
        passwordHash: null,
        ...flags,
      })
      .where(eq(schema.users.id, userId));
  } else {
    await db.insert(schema.users).values({
      id: userId,
      companyId: session.companyId,
      email,
      role: "manager",
      isOwner: false,
      ...flags,
      inviteToken,
      inviteAcceptedAt: null,
    });
  }

  // Stash the name so the invite page can greet them properly and so the
  // Team roster shows "Jane Doe" instead of just the email. For a resurrected
  // row, upsert the profile instead of inserting (the old one is still there).
  const [existingProfile] = await db
    .select()
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, userId));
  if (existingProfile) {
    await db
      .update(schema.managerProfiles)
      .set({ firstName, lastName })
      .where(eq(schema.managerProfiles.userId, userId));
  } else {
    await db.insert(schema.managerProfiles).values({ userId, firstName, lastName });
  }

  // Replace location assignments cleanly on a resurrect.
  if (archivedPrior) {
    await db.delete(schema.userLocations).where(eq(schema.userLocations.userId, userId));
  }
  const companyLocations = await db
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.companyId, session.companyId));
  const validSet = new Set(companyLocations.map((l) => l.id));
  for (const locId of locationIds) {
    if (!validSet.has(locId)) continue;
    await db.insert(schema.userLocations).values({ userId, locationId: locId });
  }

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const inviteUrl = `${proto}://${host}/invite/${inviteToken}`;
  await sendManagerInviteEmail({
    toEmail: email,
    firstName,
    companyId: session.companyId,
    companyName: company?.name ?? "Your company",
    inviteUrl,
    flags,
  });

  revalidatePath("/manager/team");
  redirect("/manager/team?saved=manager-invited");
}

/**
 * Re-send the welcome email - but with a NEW password the owner types here.
 * (We can't re-send the original because passwords are stored hashed.)
 */
async function resendWelcomeAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const userId = String(formData.get("userId"));

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId || target.role !== "manager") throw new Error("Not found");
  if (target.isOwner) throw new Error("Can't reset the owner's credentials here");

  // Regenerate the invite token so the old link stops working, and (if the
  // manager had already set a password) clear it so they must go through
  // the invite flow again. Parallels staff Resend invite.
  const newToken = makeInviteToken();
  await db.update(schema.users)
    .set({ inviteToken: newToken, inviteAcceptedAt: null, passwordHash: null })
    .where(eq(schema.users.id, userId));

  const [profile] = await db.select().from(schema.managerProfiles).where(eq(schema.managerProfiles.userId, userId));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const inviteUrl = `${proto}://${host}/invite/${newToken}`;
  await sendManagerInviteEmail({
    toEmail: target.email,
    firstName: profile?.firstName ?? "there",
    companyId: session.companyId,
    companyName: company?.name ?? "Your company",
    inviteUrl,
    flags: {
      canAccessCalendar: !!target.canAccessCalendar,
      canAccessStaff: !!target.canAccessStaff,
      canAccessLog: !!target.canAccessLog,
      canAccessPayroll: !!target.canAccessPayroll,
      canAccessTeam: !!target.canAccessTeam,
      canEditSettings: !!target.canEditSettings,
    },
  });

  revalidatePath("/manager/team");
}

/**
 * Save all five access checkboxes at once for a given manager. Unchecked boxes
 * don't send "on", so reading the entire form is the simplest way to persist
 * the full state (checked AND unchecked) in one round-trip.
 */
async function updatePermissionsAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const userId = String(formData.get("userId"));
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId || target.role !== "manager") throw new Error("Not found");
  if (target.isOwner) throw new Error("Owner permissions can't be toggled");
  const flags = readAccessFlags(formData);
  await db.update(schema.users).set(flags).where(eq(schema.users.id, userId));
  revalidatePath("/manager/team");
}

async function removeManagerAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const userId = String(formData.get("userId"));
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId || target.role !== "manager") throw new Error("Not found");
  if (target.isOwner) throw new Error("Can't remove the company owner");
  await db.update(schema.users).set({ archivedAt: new Date() }).where(eq(schema.users.id, userId));
  await sendAccountChangeEmail(target.email, session.companyId, "removed");
  revalidatePath("/manager/team");
}

/**
 * Suspend or restore a manager. Suspension blocks login but keeps the row
 * intact so history and permissions stay recoverable with one click.
 */
/**
 * One-time fix for legacy data where multiple is_owner=true rows ended
 * up in the same company. Collapses to the earliest-created owner;
 * demotes the rest to full-access managers (minus admin). Any current
 * owner can trigger this once from the Admin page.
 */
async function collapseOwnersAction() {
  "use server";
  const { session } = await requireOwner();
  const owners = await db
    .select()
    .from(schema.users)
    .where(and(
      eq(schema.users.companyId, session.companyId),
      eq(schema.users.role, "manager"),
      eq(schema.users.isOwner, true),
    ));
  const active = owners.filter((u) => !u.archivedAt);
  if (active.length < 2) return;
  active.sort((a, b) => {
    const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (aT !== bT) return aT - bT;
    return a.id.localeCompare(b.id);
  });
  const keep = active[0];
  for (const u of active) {
    if (u.id === keep.id) continue;
    await db.update(schema.users).set({
      isOwner: false,
      canAccessCalendar: true,
      canAccessStaff: true,
      canAccessLog: true,
      canAccessPayroll: true,
      canAccessTeam: false,
      canEditSettings: true,
    }).where(eq(schema.users.id, u.id));
  }
  revalidatePath("/manager/team");
}

async function toggleSuspendAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const userId = String(formData.get("userId"));
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId || target.role !== "manager") throw new Error("Not found");
  if (target.isOwner) throw new Error("Can't suspend the company owner");
  const nowSuspended = !target.suspendedAt;
  await db
    .update(schema.users)
    .set({ suspendedAt: nowSuspended ? new Date() : null })
    .where(eq(schema.users.id, userId));
  await sendAccountChangeEmail(target.email, session.companyId, nowSuspended ? "suspended" : "restored");
  revalidatePath("/manager/team");
}

/**
 * Short email sent to a manager when the owner flips their account state
 * (suspended, restored, or removed). Keeps the subject punchy so it's
 * immediately clear what happened; the body explains what to do next.
 * No action buttons — the whole point is that they're locked out /
 * reinstated by the owner, not self-service.
 */
async function sendAccountChangeEmail(
  toEmail: string,
  companyId: string,
  kind: "suspended" | "restored" | "removed",
) {
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const companyName = company?.name ?? "Scheduler";

  const subject =
    kind === "suspended" ? `Your ${companyName} account was suspended`
    : kind === "restored" ? `Your ${companyName} access was restored`
    : `Your ${companyName} account was removed`;

  const lead =
    kind === "suspended"
      ? `Your ${companyName} account has been suspended by the owner. You won't be able to log in until it's restored.`
      : kind === "restored"
      ? `Your ${companyName} account access has been restored. You can log in again normally.`
      : `Your ${companyName} account has been removed. You can no longer log in.`;

  const followUp =
    kind === "suspended" || kind === "removed"
      ? `If you believe this is a mistake, reach out to the owner of ${companyName} directly — Scheduler support can't lift this for you.`
      : `Welcome back.`;

  const textBody = [`Hi,`, ``, lead, ``, followUp, ``, `– ${companyName}`].join("\n");

  const htmlBody = shellWrap([
    greeting(null, lead),
    paragraph(followUp, { muted: true }),
    signoff(companyName),
  ].join("\n"));

  await sendEmail({
    to: toEmail,
    subject,
    body: textBody,
    html: htmlBody,
    companyId,
  });
}

export default async function TeamPage({ searchParams }: { searchParams: { err?: string; saved?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner && !me?.canAccessTeam) redirect("/manager?denied=team");

  const allLocations = await db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.companyId, session.companyId));
  const activeLocations = allLocations.filter((l) => !l.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);

  const managers = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.companyId, session.companyId), eq(schema.users.role, "manager")));
  const active = managers.filter((u) => !u.archivedAt);
  active.sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    return a.email.localeCompare(b.email);
  });

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={me.email} role="manager" logoUrl={company.logoUrl} isOwner={!!me.isOwner} canAccessCalendar={!!me.canAccessCalendar} canAccessStaff={!!me.canAccessStaff} canAccessLog={!!me.canAccessLog} canAccessTeam={!!me.canAccessTeam} canEditSettings={!!me.canEditSettings} />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        {searchParams.err && (
          <div className="mt-4 border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">
            {searchParams.err}
          </div>
        )}
        {searchParams.saved === "manager-invited" && (
          <div className="mt-4 border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Invite sent. They&apos;ll finish setup from the email link.
          </div>
        )}
        <h1 className="text-2xl font-semibold mt-2 mb-2">Admin</h1>
        <p className="text-sm text-gray-600 mb-6">
          {me.isOwner
            ? `Who can log in to run the app for ${company.name}. Click Edit next to anyone to change their access, suspend login, reset their password, or remove them. Only you (the owner) can make these changes.`
            : `Logins for ${company.name}. Only the company owner can add, edit, suspend, or remove managers.`}
        </p>

        {me.isOwner && active.filter((u) => u.isOwner).length > 1 && (
          <div className="mb-6 border border-amber-300 bg-amber-50 rounded-lg p-4">
            <div className="font-medium text-amber-900">Multiple owners detected</div>
            <p className="text-sm text-amber-800 mt-1">
              {active.filter((u) => u.isOwner).length} managers are marked as owner. There should be exactly one.
              Clicking the button below keeps the earliest-created account (that&apos;s the one who signed up the company)
              as sole owner and converts the rest into regular managers with full access except for this Admin page.
            </p>
            <form action={collapseOwnersAction} className="mt-3">
              <button type="submit" className="btn btn-primary text-sm">Collapse to single owner</button>
            </form>
          </div>
        )}

        <section className="border rounded-lg bg-white divide-y">
          {active.map((u) => {
            const pending = !u.inviteAcceptedAt && !u.isOwner;
            const suspended = !!u.suspendedAt;
            const canEditThis = canModifyManager(
              { id: me.id, companyId: me.companyId, role: "manager", isOwner: !!me.isOwner },
              { id: u.id, companyId: u.companyId, role: "manager", isOwner: !!u.isOwner },
            );
            const headerBlock = (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    {u.email}
                    {u.isOwner && (
                      <span className="text-[10px] uppercase tracking-wide bg-gray-900 text-white px-1.5 py-0.5 rounded">
                        Owner
                      </span>
                    )}
                    {suspended && (
                      <span className="text-[10px] uppercase tracking-wide bg-red-100 text-red-800 border border-red-300 px-1.5 py-0.5 rounded">
                        Suspended
                      </span>
                    )}
                    {pending && !suspended && (
                      <span className="text-[10px] uppercase tracking-wide bg-yellow-100 text-yellow-800 border border-yellow-300 px-1.5 py-0.5 rounded">
                        Pending first login
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {u.isOwner
                      ? "Full access to everything"
                      : `Access: ${accessSummary({
                          canAccessCalendar: !!u.canAccessCalendar,
                          canAccessStaff: !!u.canAccessStaff,
                          canAccessLog: !!u.canAccessLog,
                          canAccessPayroll: !!u.canAccessPayroll,
                          canAccessTeam: !!u.canAccessTeam,
                          canEditSettings: !!u.canEditSettings,
                        })}`}
                    {u.inviteAcceptedAt && !u.isOwner && (
                      <span className="text-gray-400"> · last welcomed {new Date(u.inviteAcceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    )}
                  </div>
                </div>
                {canEditThis && (
                  <span className="btn btn-secondary text-sm shrink-0 pointer-events-none">
                    Edit
                  </span>
                )}
              </div>
            );
            return (
              <div key={u.id} className="px-4 py-3">
                {canEditThis ? (
                  <details className="group">
                    <summary className="cursor-pointer list-none">
                      {headerBlock}
                    </summary>
                    <div className="mt-3 pt-3 border-t space-y-4">
                      <form action={updatePermissionsAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                          <AccessCheckbox id={`cal-${u.id}`}      name="canAccessCalendar" label="Calendar" defaultChecked={!!u.canAccessCalendar} />
                          <AccessCheckbox id={`staff-${u.id}`}    name="canAccessStaff"    label="Staff"    defaultChecked={!!u.canAccessStaff} />
                          <AccessCheckbox id={`log-${u.id}`}      name="canAccessLog"      label="Log"      defaultChecked={!!u.canAccessLog} />
                          <AccessCheckbox id={`payroll-${u.id}`}  name="canAccessPayroll"  label="Payroll"  defaultChecked={!!u.canAccessPayroll} />
                          <AccessCheckbox id={`team-${u.id}`}     name="canAccessTeam"     label="Admin"    defaultChecked={!!u.canAccessTeam} />
                          <AccessCheckbox id={`settings-${u.id}`} name="canEditSettings"   label="Settings" defaultChecked={!!u.canEditSettings} />
                          <button type="submit" className="btn btn-secondary text-xs ml-auto">Update access</button>
                        </div>
                      </form>

                      <form action={resendWelcomeAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          className="text-xs text-gray-600 underline hover:text-black"
                          title={pending
                            ? "Email them a fresh invite link (the old one stops working)"
                            : "Reset their password and email them a fresh invite link"}
                        >
                          {pending ? "Resend invite" : "Reset password & resend invite"}
                        </button>
                      </form>

                      <div className="flex items-center gap-4 pt-3 border-t">
                        <form action={toggleSuspendAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button
                            type="submit"
                            className={`text-sm ${suspended ? "text-green-700" : "text-amber-700"} hover:underline`}
                            title={suspended ? "Restore access" : "Block login without deleting"}
                          >
                            {suspended ? "Restore access" : "Suspend"}
                          </button>
                        </form>
                        <form action={removeManagerAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button type="submit" className="text-sm text-red-600 hover:underline">Remove</button>
                        </form>
                      </div>
                    </div>
                  </details>
                ) : (
                  headerBlock
                )}
              </div>
            );
          })}
        </section>

        {me.isOwner && (
        <section className="mt-10 border rounded-lg bg-white p-5">
          <h2 className="font-semibold mb-1">Add a manager</h2>
          <p className="text-sm text-gray-600 mb-4">
            Same shape as adding a staff member — you fill in the basics, we email them an invite link.
            They set their own password when they open it. Tick which sections they can see; Calendar, Staff, Log, and Payroll are on by default.
          </p>
          <form action={addManagerAction} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="label">First name</label>
                <input id="firstName" name="firstName" required className="input" />
              </div>
              <div>
                <label htmlFor="lastName" className="label">Last name</label>
                <input id="lastName" name="lastName" required className="input" />
              </div>
            </div>
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" name="email" type="email" required className="input" placeholder="employee@yourcompany.com" />
            </div>
            <div>
              <div className="label mb-2">Access</div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <AccessCheckbox id="new-cal"      name="canAccessCalendar" label="Calendar" defaultChecked />
                <AccessCheckbox id="new-staff"    name="canAccessStaff"    label="Staff"    defaultChecked />
                <AccessCheckbox id="new-log"      name="canAccessLog"      label="Log"      defaultChecked />
                <AccessCheckbox id="new-payroll"  name="canAccessPayroll"  label="Payroll"  defaultChecked />
                <AccessCheckbox id="new-team"     name="canAccessTeam"     label="Admin" />
                <AccessCheckbox id="new-settings" name="canEditSettings"   label="Settings" />
              </div>
            </div>
            <div className="pt-2">
              <div className="label mb-2">Locations <span className="text-red-500">*</span></div>
              <p className="text-xs text-gray-500 mb-2">Pick at least one. This manager will only see events + staff at the locations you tick here.</p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                {activeLocations.map((l) => (
                  <label key={l.id} className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="locationIds" value={l.id} className="w-4 h-4" />
                    <span>{l.name}</span>
                  </label>
                ))}
                {activeLocations.length === 0 && (
                  <span className="text-xs text-gray-500 italic">No locations yet — add one under Settings → Locations first.</span>
                )}
              </div>
            </div>
            <div className="pt-2">
              <button type="submit" className="btn btn-primary">Send invite</button>
            </div>
          </form>
        </section>
        )}
      </main>
    </div>
  );
}

function AccessCheckbox({
  id, name, label, defaultChecked,
}: { id: string; name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 cursor-pointer">
      <input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} className="w-4 h-4" />
      <span>{label}</span>
    </label>
  );
}
