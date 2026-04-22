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

async function requireOwner() {
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner) throw new Error("Forbidden: owner only");
  return { session, me };
}

/**
 * Build + send the welcome email that tells a newly-added manager how to log in.
 * Includes their email, the starting password, a link to /login, and a note about
 * password changes (not yet supported, so they should keep using this one).
 */
async function sendWelcomeManagerEmail({
  toEmail,
  password,
  companyId,
  companyName,
  loginUrl,
  canEditSettings,
}: {
  toEmail: string;
  password: string;
  companyId: string;
  companyName: string;
  loginUrl: string;
  canEditSettings: boolean;
}) {
  const scopeNote = canEditSettings
    ? "You'll be able to manage the calendar, staff, and company settings."
    : "You'll be able to manage the calendar and staff. Company settings are owner-only unless the owner grants you access.";

  const textBody = [
    `Welcome!`, ``,
    `${companyName} has given you a manager login to its scheduling app.`, ``,
    `Sign in at: ${loginUrl}`,
    `Email:      ${toEmail}`,
    `Password:   ${password}`, ``,
    scopeNote, ``,
    `Keep this email — password changes from inside the app aren't available yet,`,
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
      "Keep this email — password changes from inside the app aren't available yet, so you'll continue using this password for now.",
      { muted: true },
    ),
    signoff(companyName),
  ].join("\n"));

  await sendEmail({
    to: toEmail,
    subject: `${companyName} — your manager login`,
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
  const canEditSettings = formData.get("canEditSettings") === "on";
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
    canEditSettings,
    // Intentionally null — inviteAcceptedAt gets set on their first successful
    // login. Until then the Team page shows "Pending first login."
    inviteAcceptedAt: null,
  });

  // Fire the welcome email with the plaintext password so the owner doesn't
  // have to copy/paste it into Slack or a text message manually.
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
    canEditSettings,
  });

  revalidatePath("/manager/team");
}

/**
 * Re-send the welcome email — but with a NEW password the owner types here.
 * (We can't re-send the original because passwords are stored hashed. Asking
 * for a new one is the safest move and doubles as a password-reset for
 * managers who forget theirs.)
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
    canEditSettings: target.canEditSettings,
  });

  revalidatePath("/manager/team");
}

async function togglePermissionAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const userId = String(formData.get("userId"));
  const newValue = formData.get("canEditSettings") === "true";
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!target || target.companyId !== session.companyId || target.role !== "manager") throw new Error("Not found");
  if (target.isOwner) throw new Error("Owner permissions can't be toggled");
  await db.update(schema.users).set({ canEditSettings: newValue }).where(eq(schema.users.id, userId));
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

export default async function TeamPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner) redirect("/manager?denied=team");

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
      <AppHeader companyName={company.name} userEmail={me.email} role="manager" logoUrl={company.logoUrl} isOwner={!!me.isOwner} canEditSettings={!!me.canEditSettings} />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Team</h1>
        <p className="text-sm text-gray-600 mb-6">
          Manage who can log in to run the app for {company.name}. Only the company owner (you) can see this page and make changes.
        </p>

        <section className="border rounded-lg bg-white divide-y">
          {active.map((u) => {
            const pending = !u.inviteAcceptedAt && !u.isOwner;
            return (
              <div key={u.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    {u.email}
                    {u.isOwner && (
                      <span className="text-[10px] uppercase tracking-wide bg-gray-900 text-white px-1.5 py-0.5 rounded">
                        Owner
                      </span>
                    )}
                    {pending && (
                      <span className="text-[10px] uppercase tracking-wide bg-yellow-100 text-yellow-800 border border-yellow-300 px-1.5 py-0.5 rounded">
                        Pending first login
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {u.isOwner
                      ? "Full access to everything"
                      : u.canEditSettings
                        ? "Manager · can edit company settings"
                        : "Manager · calendar + staff only"}
                    {u.inviteAcceptedAt && !u.isOwner && (
                      <span className="text-gray-400"> · last welcomed {new Date(u.inviteAcceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    )}
                  </div>
                  {pending && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer underline">Re-send welcome email with a new password</summary>
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
                    </details>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 pt-1">
                  {!u.isOwner && (
                    <>
                      <form action={togglePermissionAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="canEditSettings" value={u.canEditSettings ? "false" : "true"} />
                        <button
                          type="submit"
                          className="text-sm underline text-gray-600 hover:text-black"
                        >
                          {u.canEditSettings ? "Revoke settings access" : "Grant settings access"}
                        </button>
                      </form>
                      <form action={removeManagerAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          className="text-sm text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section className="mt-10 border rounded-lg bg-white p-5">
          <h2 className="font-semibold mb-1">Add a manager</h2>
          <p className="text-sm text-gray-600 mb-4">
            Creates a login for one of your employees and <strong>emails them</strong> their login URL + credentials.
            By default they can manage the calendar and staff. Tick the box below to also let them edit company branding + notification settings.
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
            <div className="flex items-center gap-2">
              <input id="canEditSettings" name="canEditSettings" type="checkbox" className="w-4 h-4" />
              <label htmlFor="canEditSettings" className="text-sm">
                Can edit company settings (branding, name, notifications)
              </label>
            </div>
            <div className="pt-2">
              <button type="submit" className="btn btn-primary">Add manager &amp; email credentials</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
