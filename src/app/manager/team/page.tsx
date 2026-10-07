import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hashPassword } from "@/lib/auth";
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
  canAccessTeam: boolean;
  canEditSettings: boolean;
};

// Display labels for the scope-note in the welcome email, in nav order.
const ACCESS_LABELS: Record<keyof AccessFlags, string> = {
  canAccessCalendar: "Calendar",
  canAccessStaff: "Staff",
  canAccessLog: "Log",
  canAccessTeam: "Admin",
  canEditSettings: "Settings",
};

function readAccessFlags(formData: FormData): AccessFlags {
  return {
    canAccessCalendar: formData.get("canAccessCalendar") === "on",
    canAccessStaff: formData.get("canAccessStaff") === "on",
    canAccessLog: formData.get("canAccessLog") === "on",
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
async function sendWelcomeManagerEmail({
  toEmail,
  password,
  companyId,
  companyName,
  loginUrl,
  flags,
}: {
  toEmail: string;
  password: string;
  companyId: string;
  companyName: string;
  loginUrl: string;
  flags: AccessFlags;
}) {
  const scopeNote = `Your access includes: ${accessSummary(flags)}.`;

  const textBody = [
    `Welcome!`, ``,
    `${companyName} has given you a manager login to its scheduling app.`, ``,
    `Sign in at: ${loginUrl}`,
    `Email:      ${toEmail}`,
    `Password:   ${password}`, ``,
    scopeNote, ``,
    `Keep this email - password changes from inside the app aren't available yet,`,
    `so you'll continue using this password for now.`, ``,
    `– ${companyName}`,
  ].join("\n");

  const htmlBody = shellWrap([
    greeting(null, `${companyName} has given you a manager login to its scheduling app.`),
    `<p style="margin:0 0 8px;font-weight:600;">Your credentials</p>`,
    kvTable([
      kvRow("Sign in at", loginUrl),
      kvRow("Email", toEmail),
      kvRow("Password", password),
    ]),
    paragraph(scopeNote),
    paragraph(
      "Keep this email - password changes from inside the app aren't available yet, so you'll continue using this password for now.",
      { muted: true },
    ),
    signoff(companyName),
  ].join("\n"));

  await sendEmail({
    to: toEmail,
    subject: `${companyName} - your manager login`,
    body: textBody,
    html: htmlBody,
    companyId,
  });
}

async function addManagerAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const flags = readAccessFlags(formData);
  if (!email || !password) throw new Error("Email and password are required");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");

  const dup = await db.select().from(schema.users).where(
    and(eq(schema.users.companyId, session.companyId), eq(schema.users.email, email)),
  );
  if (dup.length > 0) throw new Error(`A user with email ${email} already exists in your company`);

  const userId = nanoid();
  await db.insert(schema.users).values({
    id: userId,
    companyId: session.companyId,
    email,
    passwordHash: hashPassword(password),
    role: "manager",
    isOwner: false,
    ...flags,
    // Intentionally null - inviteAcceptedAt gets set on their first successful
    // login. Until then the Team page shows "Pending first login."
    inviteAcceptedAt: null,
  });

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const loginUrl = `${proto}://${host}/login`;
  await sendWelcomeManagerEmail({
    toEmail: email,
    password,
    companyId: session.companyId,
    companyName: company?.name ?? "Your company",
    loginUrl,
    flags,
  });

  revalidatePath("/manager/team");
}

/**
 * Re-send the welcome email - but with a NEW password the owner types here.
 * (We can't re-send the original because passwords are stored hashed.)
 */
async function resendWelcomeAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const userId = String(formData.get("userId"));
  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword.length < 8) throw new Error("New password must be at least 8 characters");

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId || target.role !== "manager") throw new Error("Not found");
  if (target.isOwner) throw new Error("Can't reset the owner's credentials here");

  await db.update(schema.users)
    .set({ passwordHash: hashPassword(newPassword), inviteAcceptedAt: null })
    .where(eq(schema.users.id, userId));

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const loginUrl = `${proto}://${host}/login`;
  await sendWelcomeManagerEmail({
    toEmail: target.email,
    password: newPassword,
    companyId: session.companyId,
    companyName: company?.name ?? "Your company",
    loginUrl,
    flags: {
      canAccessCalendar: !!target.canAccessCalendar,
      canAccessStaff: !!target.canAccessStaff,
      canAccessLog: !!target.canAccessLog,
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
  await db
    .update(schema.users)
    .set({ suspendedAt: target.suspendedAt ? null : new Date() })
    .where(eq(schema.users.id, userId));
  revalidatePath("/manager/team");
}

export default async function TeamPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner && !me?.canAccessTeam) redirect("/manager?denied=team");

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
                          <AccessCheckbox id={`team-${u.id}`}     name="canAccessTeam"     label="Admin"    defaultChecked={!!u.canAccessTeam} />
                          <AccessCheckbox id={`settings-${u.id}`} name="canEditSettings"   label="Settings" defaultChecked={!!u.canEditSettings} />
                          <button type="submit" className="btn btn-secondary text-xs ml-auto">Update access</button>
                        </div>
                      </form>

                      <details>
                        <summary className="text-xs text-gray-500 cursor-pointer underline">
                          {pending
                            ? "Re-send welcome email with a new password"
                            : "Reset their password & re-send login email"}
                        </summary>
                        <form action={resendWelcomeAction} className="mt-2 flex items-end gap-2">
                          <input type="hidden" name="userId" value={u.id} />
                          <div className="flex-1">
                            <label className="label text-xs" htmlFor={`newpw-${u.id}`}>New starting password</label>
                            <input
                              id={`newpw-${u.id}`}
                              name="newPassword"
                              type="text"
                              minLength={8}
                              required
                              className="input text-sm"
                              placeholder="At least 8 chars"
                            />
                          </div>
                          <button type="submit" className="btn btn-secondary text-sm">Send</button>
                        </form>
                        {!pending && (
                          <p className="text-xs text-gray-500 mt-1">
                            This overwrites their current password. They&apos;ll need to use the new one you set here.
                          </p>
                        )}
                      </details>

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
            Creates a login for one of your employees and <strong>emails them</strong> their login URL + credentials.
            Tick the sections they&apos;re allowed to access - Calendar, Staff, and Log are checked by default.
          </p>
          <form action={addManagerAction} className="space-y-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" name="email" type="email" required className="input" placeholder="employee@yourcompany.com" />
            </div>
            <div>
              <label htmlFor="password" className="label">Starting password</label>
              <input id="password" name="password" type="text" required minLength={8} className="input" placeholder="At least 8 characters" />
              <p className="text-xs text-gray-500 mt-1">
                You set it, we email it. In-app password changes aren&apos;t built yet, so they&apos;ll keep using this one.
              </p>
            </div>
            <div>
              <div className="label mb-2">Access</div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <AccessCheckbox id="new-cal"      name="canAccessCalendar" label="Calendar" defaultChecked />
                <AccessCheckbox id="new-staff"    name="canAccessStaff"    label="Staff"    defaultChecked />
                <AccessCheckbox id="new-log"      name="canAccessLog"      label="Log"      defaultChecked />
                <AccessCheckbox id="new-team"     name="canAccessTeam"     label="Admin" />
                <AccessCheckbox id="new-settings" name="canEditSettings"   label="Settings" />
              </div>
            </div>
            <div className="pt-2">
              <button type="submit" className="btn btn-primary">Add a manager</button>
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
