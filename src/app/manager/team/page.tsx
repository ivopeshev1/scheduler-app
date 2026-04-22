import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hashPassword } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

async function requireOwner() {
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner) throw new Error("Forbidden: owner only");
  return { session, me };
}

async function addManagerAction(formData: FormData) {
  "use server";
  const { session } = await requireOwner();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const canEditSettings = formData.get("canEditSettings") === "on";
  if (!email || !password) throw new Error("Email and password are required");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");

  // Reject duplicate emails within the company
  const dup = await db.select().from(schema.users).where(
    and(eq(schema.users.companyId, session.companyId), eq(schema.users.email, email)),
  );
  if (dup.length > 0) throw new Error(`A user with email ${email} already exists in your company`);

  await db.insert(schema.users).values({
    id: nanoid(),
    companyId: session.companyId,
    email,
    passwordHash: hashPassword(password),
    role: "manager",
    isOwner: false,
    canEditSettings,
    inviteAcceptedAt: new Date(),
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

  // Soft-delete (archive) so any audit rows pointing to this user still resolve
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
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1; // owner first
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
          {active.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {u.email}
                  {u.isOwner && (
                    <span className="text-[10px] uppercase tracking-wide bg-gray-900 text-white px-1.5 py-0.5 rounded">
                      Owner
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {u.isOwner
                    ? "Full access to everything"
                    : u.canEditSettings
                      ? "Manager · can edit company settings"
                      : "Manager · calendar + staff only"}
                </div>
              </div>
              <div className="flex items-center gap-3">
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
          ))}
        </section>

        <section className="mt-10 border rounded-lg bg-white p-5">
          <h2 className="font-semibold mb-1">Add a manager</h2>
          <p className="text-sm text-gray-600 mb-4">
            Creates a login for one of your employees. You set their starting password here — share it with them
            privately and they can log in at <code className="px-1 bg-gray-100 rounded">/login</code>. By default they can
            manage the calendar and staff. Tick the box below to also let them edit company branding + notification settings.
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
                Shown in plaintext so you can copy/share it. Tell them to log in and they can keep using this password
                (password-change UI is still on the todo list).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input id="canEditSettings" name="canEditSettings" type="checkbox" className="w-4 h-4" />
              <label htmlFor="canEditSettings" className="text-sm">
                Can edit company settings (branding, name, notifications)
              </label>
            </div>
            <div className="pt-2">
              <button type="submit" className="btn btn-primary">Add manager</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
