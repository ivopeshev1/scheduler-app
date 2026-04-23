import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, asc, desc } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

/**
 * Google Drive share URLs point to a viewer page, not the raw image, so browsers
 * can't render them in an <img> tag. Detect the common forms and rewrite them
 * to the thumbnail endpoint (which serves the actual image bytes).
 */
function normalizeLogoUrl(raw: string): string | null {
  if (!raw) return null;
  const m1 = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.exec(raw);
  if (m1) return `https://drive.google.com/thumbnail?id=${m1[1]}&sz=w400`;
  const m2 = /drive\.google\.com\/open\?.*id=([a-zA-Z0-9_-]+)/.exec(raw);
  if (m2) return `https://drive.google.com/thumbnail?id=${m2[1]}&sz=w400`;
  return raw;
}

async function requireSettingsAccess() {
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner && !me?.canEditSettings) throw new Error("Forbidden: you don't have permission to edit settings");
  return { session, me };
}

async function saveCompanySetupAction(formData: FormData) {
  "use server";
  const { session } = await requireSettingsAccess();
  const name = String(formData.get("name") ?? "").trim();
  const logoUrlRaw = String(formData.get("logoUrl") ?? "").trim();
  if (!name) throw new Error("Company name is required");
  const logoUrl = normalizeLogoUrl(logoUrlRaw);

  await db
    .update(schema.companies)
    .set({ name, logoUrl })
    .where(eq(schema.companies.id, session.companyId));

  revalidatePath("/manager");
  revalidatePath("/manager/settings");
  redirect("/manager/settings?saved=company");
}

async function saveNotificationSettingsAction(formData: FormData) {
  "use server";
  const { session } = await requireSettingsAccess();
  const expireRaw = String(formData.get("priorityExpireDays") ?? "").trim();
  let priorityExpireDays: number | null = null;
  if (expireRaw) {
    const n = Number(expireRaw);
    if (Number.isFinite(n) && n >= 1) {
      priorityExpireDays = Math.min(60, Math.max(1, Math.floor(n)));
    }
  }

  await db
    .update(schema.companies)
    .set({ priorityExpireDays })
    .where(eq(schema.companies.id, session.companyId));

  revalidatePath("/manager/settings");
  redirect("/manager/settings?saved=notifications");
}

async function addRoleAction(formData: FormData) {
  "use server";
  const { session } = await requireSettingsAccess();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Role name is required");
  if (name.length > 60) throw new Error("Role name must be 60 characters or fewer");

  // Reject duplicates (case-insensitive) within the same company.
  const existing = await db.select().from(schema.roles).where(eq(schema.roles.companyId, session.companyId));
  if (existing.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`"${name}" is already in your list of roles`);
  }

  // Append at the end — grab the current max sortOrder by ordering desc.
  const [last] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.companyId, session.companyId))
    .orderBy(desc(schema.roles.sortOrder))
    .limit(1);
  const nextSort = (last?.sortOrder ?? -1) + 1;

  await db.insert(schema.roles).values({
    id: nanoid(),
    companyId: session.companyId,
    name,
    sortOrder: nextSort,
  });

  revalidatePath("/manager/settings");
  redirect("/manager/settings?saved=role-added");
}

async function removeRoleAction(formData: FormData) {
  "use server";
  const { session } = await requireSettingsAccess();
  const roleId = String(formData.get("roleId"));
  const [target] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));
  if (!target || target.companyId !== session.companyId) throw new Error("Not found");
  await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
  revalidatePath("/manager/settings");
  redirect("/manager/settings?saved=role-removed");
}

export default async function SettingsPage({ searchParams }: { searchParams: { saved?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user?.isOwner && !user?.canEditSettings) {
    redirect("/manager?denied=settings");
  }

  const roles = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.companyId, session.companyId))
    .orderBy(asc(schema.roles.sortOrder));

  const savedBanner = (() => {
    switch (searchParams.saved) {
      case "company":       return "Company setup saved.";
      case "notifications": return "Notification settings saved.";
      case "role-added":    return "Role added.";
      case "role-removed":  return "Role removed.";
      default:              return null;
    }
  })();

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div>
          <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
          <h1 className="text-2xl font-semibold mt-2">Settings</h1>
          <p className="text-sm text-gray-600">Configure {company.name} — company info, notification rules, roles, and more.</p>
        </div>

        {savedBanner && (
          <div className="p-3 border border-green-300 bg-green-50 text-green-800 text-sm rounded">
            {savedBanner}
          </div>
        )}

        {/* -------------------- Company setup -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="text-lg font-semibold mb-1">Company setup</h2>
          <p className="text-sm text-gray-600 mb-4">
            The name that shows up in the header and on outgoing emails, plus an optional logo.
          </p>

          <form action={saveCompanySetupAction} className="space-y-5">
            <div>
              <label htmlFor="name" className="label">Company name</label>
              <input id="name" name="name" type="text" defaultValue={company.name} required className="input" />
              <p className="text-xs text-gray-500 mt-1">
                Used in the header, email subjects, and email signoffs.
              </p>
            </div>

            <div>
              <label htmlFor="logoUrl" className="label">Logo URL (optional)</label>
              <input
                id="logoUrl"
                name="logoUrl"
                type="url"
                defaultValue={company.logoUrl ?? ""}
                placeholder="https://example.com/logo.png"
                className="input"
              />
              <p className="text-xs text-gray-500 mt-1">
                Paste a direct image URL — appears as a small icon next to your company name. Google Drive share links
                get auto-rewritten to the thumbnail endpoint.
              </p>
              {company.logoUrl && (
                <div className="mt-3 flex items-center gap-3 p-3 border rounded bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={company.logoUrl} alt="current logo" className="h-10 w-10 object-contain rounded bg-white border" />
                  <span className="text-xs text-gray-500">Current logo</span>
                </div>
              )}
            </div>

            <button type="submit" className="btn btn-primary">Save company setup</button>
          </form>
        </section>

        {/* -------------------- Notifications -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="text-lg font-semibold mb-1">Notifications</h2>
          <p className="text-sm text-gray-600 mb-4">
            When a priority invite sits this long without a response, it auto-expires. The lowest-tier backup
            is promoted and emailed. If no backup exists, you get a heads-up email instead. Leave blank to
            disable (you&apos;ll handle re-invites manually).
          </p>

          <form action={saveNotificationSettingsAction} className="space-y-4">
            <div>
              <label htmlFor="priorityExpireDays" className="label">Auto-expire priority invites after</label>
              <div className="flex items-center gap-2">
                <input
                  id="priorityExpireDays"
                  name="priorityExpireDays"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={company.priorityExpireDays ?? ""}
                  placeholder="—"
                  className="input w-24"
                />
                <span className="text-sm text-gray-700">days with no response</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Email delivery history lives on the <Link href="/manager/log" className="underline">Log</Link> page.
              </p>
            </div>

            <button type="submit" className="btn btn-primary">Save notification rules</button>
          </form>
        </section>

        {/* -------------------- Roles -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="text-lg font-semibold mb-1">Roles</h2>
          <p className="text-sm text-gray-600 mb-4">
            The list of roles you can pick from when building an event. Removing a role here hides it from
            future dropdowns, but past events that used it keep their original label.
          </p>

          {roles.length === 0 ? (
            <div className="border rounded p-4 text-sm text-gray-500 bg-gray-50">
              No roles yet. Add your first below.
            </div>
          ) : (
            <ul className="border rounded divide-y mb-4">
              {roles.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm">{r.name}</span>
                  <form action={removeRoleAction}>
                    <input type="hidden" name="roleId" value={r.id} />
                    <button type="submit" className="text-sm text-red-600 hover:underline">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={addRoleAction} className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="new-role-name" className="label">Add a new role</label>
              <input
                id="new-role-name"
                name="name"
                type="text"
                required
                maxLength={60}
                placeholder="e.g. Security, Valet, Mixologist"
                className="input"
              />
            </div>
            <button type="submit" className="btn btn-secondary whitespace-nowrap">Add role</button>
          </form>
        </section>

        {/* -------------------- Add-ons (placeholder) -------------------- */}
        <section className="border rounded-lg bg-white p-6 border-dashed">
          <h2 className="text-lg font-semibold mb-1 text-gray-600">Add-ons</h2>
          <p className="text-sm text-gray-500">
            Coming soon — extra per-shift charges you can toggle on an event (travel, van driver, etc.) will
            live here so they&apos;re managed in one place instead of entered per-event.
          </p>
        </section>
      </main>
    </div>
  );
}
