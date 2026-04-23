import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, asc, desc } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { NotificationsEditor } from "@/components/NotificationsEditor";
import {
  mergeNotificationSettings,
  type NotificationSettings,
} from "@/lib/notification-settings";
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

/**
 * Server action invoked by NotificationsEditor. Writes the whole settings blob
 * to the JSON column and the auto-expire days to its dedicated column.
 */
async function saveNotificationSettingsAction(payload: {
  settings: NotificationSettings;
  autoExpireDays: number | null;
}) {
  "use server";
  const { session } = await requireSettingsAccess();

  // Basic shape check — if the client somehow sends something broken, fall
  // back to defaults rather than writing garbage.
  const safeSettings = mergeNotificationSettings(payload.settings);

  let priorityExpireDays: number | null = null;
  if (payload.autoExpireDays != null && Number.isFinite(payload.autoExpireDays) && payload.autoExpireDays >= 1) {
    priorityExpireDays = Math.min(60, Math.max(1, Math.floor(payload.autoExpireDays)));
  }

  await db
    .update(schema.companies)
    .set({ notificationSettings: safeSettings, priorityExpireDays })
    .where(eq(schema.companies.id, session.companyId));

  revalidatePath("/manager/settings");
}

async function addRoleAction(formData: FormData) {
  "use server";
  const { session } = await requireSettingsAccess();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/manager/settings?error=role-name-required");
  }
  if (name.length > 60) {
    redirect("/manager/settings?error=role-name-too-long");
  }

  // Reject duplicates (case-insensitive) within the same company. Redirect
  // with an error banner instead of throwing — throwing surfaces a generic
  // "Application error" page, which reads as a bug rather than validation.
  const existing = await db.select().from(schema.roles).where(eq(schema.roles.companyId, session.companyId));
  if (existing.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    redirect(`/manager/settings?error=role-duplicate&name=${encodeURIComponent(name)}`);
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

/**
 * Swap a role's sortOrder with its neighbor in the given direction. The order
 * the company sets here is exactly what the event role dropdown renders, so
 * reordering is a real product setting, not just cosmetic.
 */
async function moveRoleAction(formData: FormData) {
  "use server";
  const { session } = await requireSettingsAccess();
  const roleId = String(formData.get("roleId"));
  const direction = String(formData.get("direction")) as "up" | "down";

  const all = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.companyId, session.companyId))
    .orderBy(asc(schema.roles.sortOrder));

  const idx = all.findIndex((r) => r.id === roleId);
  if (idx < 0) throw new Error("Not found");
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) {
    // Already at the edge — no-op
    redirect("/manager/settings");
  }

  const a = all[idx];
  const b = all[swapIdx];
  // Swap via a temporary value so the unique-ordering invariant is never
  // violated mid-transaction (in case we ever add a uniqueness constraint).
  await db.update(schema.roles).set({ sortOrder: -1 }).where(eq(schema.roles.id, a.id));
  await db.update(schema.roles).set({ sortOrder: a.sortOrder }).where(eq(schema.roles.id, b.id));
  await db.update(schema.roles).set({ sortOrder: b.sortOrder }).where(eq(schema.roles.id, a.id));

  revalidatePath("/manager/settings");
  redirect("/manager/settings");
}

export default async function SettingsPage({ searchParams }: { searchParams: { saved?: string; error?: string; name?: string } }) {
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

  // Banners are scoped per section — a company-setup save doesn't flash a
  // message up under the Roles header and vice versa. Keeps feedback next to
  // the form that caused it.
  const saved = searchParams.saved;
  const err = searchParams.error;
  const errName = searchParams.name ?? "";

  const companySavedMsg = saved === "company" ? "Company setup saved." : null;
  // Notifications save its own in-line "Saved." indicator inside the editor
  // component, so no top-level banner for that section.
  const rolesSavedMsg =
    saved === "role-added" ? "Role added." :
    saved === "role-removed" ? "Role removed." :
    null;
  const rolesErrorMsg =
    err === "role-duplicate" ? `"${errName}" is already in your list of roles.` :
    err === "role-name-required" ? "Role name is required." :
    err === "role-name-too-long" ? "Role name must be 60 characters or fewer." :
    null;

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div>
          <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
          <h1 className="text-2xl font-semibold mt-2">Settings</h1>
          <p className="text-sm text-gray-600">Company info, notification rules, roles, and more.</p>
        </div>

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

          {companySavedMsg && (
            <div className="mt-4 p-3 border border-green-300 bg-green-50 text-green-800 text-sm rounded">
              {companySavedMsg}
            </div>
          )}
        </section>

        {/* -------------------- Notifications -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="text-lg font-semibold mb-1">Notifications</h2>
          <p className="text-sm text-gray-600 mb-4">
            Choose which channels (email / text) each message goes out on and, where applicable,
            how often. See the <Link href="/manager/log" className="underline">Log</Link> page for
            delivery history.
          </p>

          <NotificationsEditor
            initialSettings={mergeNotificationSettings(company.notificationSettings)}
            initialAutoExpireDays={company.priorityExpireDays}
            onSave={saveNotificationSettingsAction}
          />
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
              {roles.map((r, idx) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-sm flex-1">{r.name}</span>
                  <div className="flex items-center gap-1">
                    <form action={moveRoleAction}>
                      <input type="hidden" name="roleId" value={r.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={idx === 0}
                        className="text-gray-500 hover:text-black disabled:text-gray-200 disabled:cursor-not-allowed px-1 text-lg leading-none"
                        aria-label={`Move ${r.name} up`}
                        title="Move up"
                      >
                        ↑
                      </button>
                    </form>
                    <form action={moveRoleAction}>
                      <input type="hidden" name="roleId" value={r.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={idx === roles.length - 1}
                        className="text-gray-500 hover:text-black disabled:text-gray-200 disabled:cursor-not-allowed px-1 text-lg leading-none"
                        aria-label={`Move ${r.name} down`}
                        title="Move down"
                      >
                        ↓
                      </button>
                    </form>
                  </div>
                  <form action={removeRoleAction}>
                    <input type="hidden" name="roleId" value={r.id} />
                    <button type="submit" className="text-sm text-red-600 hover:underline">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500 mb-4">
            The order shown here is the order roles appear in event dropdowns — use ↑ / ↓ to rearrange.
          </p>

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

          {rolesSavedMsg && (
            <div className="mt-4 p-3 border border-green-300 bg-green-50 text-green-800 text-sm rounded">
              {rolesSavedMsg}
            </div>
          )}
          {rolesErrorMsg && (
            <div className="mt-4 p-3 border border-red-300 bg-red-50 text-red-800 text-sm rounded">
              {rolesErrorMsg}
            </div>
          )}
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
