import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, asc, desc } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { NotificationsEditor } from "@/components/NotificationsEditor";
import { RolesList } from "@/components/RolesList";
import { AddOnsList } from "@/components/AddOnsList";
import { EventFieldsEditor, type FieldRow } from "@/components/EventFieldsEditor";
import { PRESET_BY_KEY, PRESET_FIELDS, isPresetKey } from "@/lib/event-fields";
import {
  mergeNotificationSettings,
  type NotificationSettings,
} from "@/lib/notification-settings";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

// Max logo file size. 1 MB is plenty for a header icon and keeps the row
// size reasonable even if we're storing the image inline as a data URL.
const MAX_LOGO_BYTES = 1_000_000;
const ALLOWED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

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
  if (!name) throw new Error("Company name is required");

  // Logo handling: file takes priority (if one was uploaded, replace). If
  // the "remove" checkbox is ticked and no file was uploaded, null the
  // column. Otherwise, leave the current value alone.
  const removeLogo = formData.get("removeLogo") === "on";
  const logoFile = formData.get("logoFile");
  let logoPatch: { logoUrl: string | null } | null = null;

  if (logoFile instanceof File && logoFile.size > 0) {
    if (!ALLOWED_LOGO_TYPES.has(logoFile.type)) {
      redirect("/manager/settings?error=logo-bad-type");
    }
    if (logoFile.size > MAX_LOGO_BYTES) {
      redirect("/manager/settings?error=logo-too-big");
    }
    // Read the raw bytes and encode as a data URL. This keeps us off of
    // third-party blob storage for now — fine at small scale because logos
    // are loaded once per page and are well under a MB.
    const buf = Buffer.from(await logoFile.arrayBuffer());
    logoPatch = { logoUrl: `data:${logoFile.type};base64,${buf.toString("base64")}` };
  } else if (removeLogo) {
    logoPatch = { logoUrl: null };
  }

  await db
    .update(schema.companies)
    .set({ name, ...(logoPatch ?? {}) })
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

  // Basic shape check - if the client somehow sends something broken, fall
  // back to defaults rather than writing garbage.
  const safeSettings = mergeNotificationSettings(payload.settings);

  // Auto-expire days is required now — if the client somehow sent something
  // bad, fall back to the UI default (2) rather than storing null.
  const raw = payload.autoExpireDays;
  const priorityExpireDays = raw != null && Number.isFinite(raw) && raw >= 1
    ? Math.min(60, Math.floor(raw))
    : 2;

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
  // with an error banner instead of throwing - throwing surfaces a generic
  // "Application error" page, which reads as a bug rather than validation.
  const existing = await db.select().from(schema.roles).where(eq(schema.roles.companyId, session.companyId));
  if (existing.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    redirect(`/manager/settings?error=role-duplicate&name=${encodeURIComponent(name)}`);
  }

  // Append at the end - grab the current max sortOrder by ordering desc.
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

/**
 * Remove role by id, called from RolesList's client-side "Remove" button
 * (not a form-submission action, so no redirect — we rely on the client
 * component's optimistic update + revalidatePath for the persisted refresh).
 */
async function removeRoleByIdAction(roleId: string) {
  "use server";
  const { session } = await requireSettingsAccess();
  const [target] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));
  if (!target || target.companyId !== session.companyId) throw new Error("Not found");
  await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
  revalidatePath("/manager/settings");
}

/* -------------------- Add-ons server actions -------------------- */

async function addAddOnAction(formData: FormData) {
  "use server";
  const { session } = await requireSettingsAccess();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/manager/settings?error=addon-name-required");
  if (name.length > 60) redirect("/manager/settings?error=addon-name-too-long");

  const includeDescription = formData.get("includeDescription") === "on";

  // Reject name duplicates within a company (case-insensitive)
  const existing = await db.select().from(schema.addOns).where(eq(schema.addOns.companyId, session.companyId));
  if (existing.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
    redirect(`/manager/settings?error=addon-duplicate&name=${encodeURIComponent(name)}`);
  }

  const [last] = await db
    .select()
    .from(schema.addOns)
    .where(eq(schema.addOns.companyId, session.companyId))
    .orderBy(desc(schema.addOns.sortOrder))
    .limit(1);
  const nextSort = (last?.sortOrder ?? -1) + 1;

  // compensationMode + compensationAmount columns still exist on the table
  // (can't drop without data-loss risk) but we stop reading/writing them.
  // Default values 'standard' / NULL stay in place.
  await db.insert(schema.addOns).values({
    id: nanoid(),
    companyId: session.companyId,
    name,
    includeDescription,
    sortOrder: nextSort,
  });

  revalidatePath("/manager/settings");
  redirect("/manager/settings?saved=addon-added");
}

async function removeAddOnByIdAction(addOnId: string) {
  "use server";
  const { session } = await requireSettingsAccess();
  const [target] = await db.select().from(schema.addOns).where(eq(schema.addOns.id, addOnId));
  if (!target || target.companyId !== session.companyId) throw new Error("Not found");
  await db.delete(schema.addOns).where(eq(schema.addOns.id, addOnId));
  revalidatePath("/manager/settings");
}

async function reorderAddOnsAction(orderedIds: string[]) {
  "use server";
  const { session } = await requireSettingsAccess();
  const all = await db.select().from(schema.addOns).where(eq(schema.addOns.companyId, session.companyId));
  const allIds = new Set(all.map((a) => a.id));
  if (orderedIds.length !== all.length) throw new Error("Order must include every add-on");
  for (const id of orderedIds) {
    if (!allIds.has(id)) throw new Error("Unknown add-on id");
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(schema.addOns).set({ sortOrder: i }).where(eq(schema.addOns.id, orderedIds[i]));
  }
  revalidatePath("/manager/settings");
}

/* -------------------- Event fields server actions -------------------- */

async function addCustomEventFieldAction(label: string) {
  "use server";
  const { session } = await requireSettingsAccess();
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Field label is required");
  if (trimmed.length > 60) throw new Error("Field label must be 60 characters or fewer");
  const fieldKey = `custom_${nanoid(10)}`;
  const [last] = await db
    .select()
    .from(schema.eventFieldConfigs)
    .where(eq(schema.eventFieldConfigs.companyId, session.companyId))
    .orderBy(desc(schema.eventFieldConfigs.sortOrder))
    .limit(1);
  const nextSort = (last?.sortOrder ?? -1) + 1;
  await db.insert(schema.eventFieldConfigs).values({
    companyId: session.companyId,
    fieldKey,
    label: trimmed,
    enabled: true,
    required: false,
    shareWithStaff: false,
    notifyOnChange: false,
    isCustom: true,
    sortOrder: nextSort,
  });
  revalidatePath("/manager/settings");
}

async function saveEventFieldsAction(payload: {
  rows: Array<{
    fieldKey: string;
    label: string;
    enabled: boolean;
    required: boolean;
    shareWithStaff: boolean;
    notifyOnChange: boolean;
    isCustom: boolean;
  }>;
  deletions: string[];
}) {
  "use server";
  const { session } = await requireSettingsAccess();

  // Apply deletions first (custom-only — preset keys can't be deleted).
  for (const fieldKey of payload.deletions) {
    if (isPresetKey(fieldKey)) continue;
    await db
      .delete(schema.eventFieldConfigs)
      .where(and(
        eq(schema.eventFieldConfigs.companyId, session.companyId),
        eq(schema.eventFieldConfigs.fieldKey, fieldKey),
      ));
  }

  for (const row of payload.rows) {
    // Preset fields that are locked on for enabled/required get those fields
    // coerced back to true server-side, regardless of what the client sends.
    const preset = PRESET_BY_KEY[row.fieldKey];
    const enabled = preset?.lockedEnabled ? true : row.enabled;
    const required = preset?.lockedRequired ? true : row.required;
    // Share toggling off forces notify off.
    const shareWithStaff = row.shareWithStaff;
    const notifyOnChange = shareWithStaff ? row.notifyOnChange : false;

    const existing = await db
      .select()
      .from(schema.eventFieldConfigs)
      .where(and(
        eq(schema.eventFieldConfigs.companyId, session.companyId),
        eq(schema.eventFieldConfigs.fieldKey, row.fieldKey),
      ));
    if (existing.length > 0) {
      await db.update(schema.eventFieldConfigs).set({
        label: row.label,
        enabled,
        required,
        shareWithStaff,
        notifyOnChange,
      }).where(and(
        eq(schema.eventFieldConfigs.companyId, session.companyId),
        eq(schema.eventFieldConfigs.fieldKey, row.fieldKey),
      ));
    } else {
      await db.insert(schema.eventFieldConfigs).values({
        companyId: session.companyId,
        fieldKey: row.fieldKey,
        label: row.label,
        enabled,
        required,
        shareWithStaff,
        notifyOnChange,
        isCustom: row.isCustom,
        sortOrder: 99,
      });
    }
  }

  revalidatePath("/manager/settings");
  revalidatePath("/manager/event/new");
}

/**
 * Persist the new order supplied by the drag-and-drop UI. Every id must
 * already belong to this company and the list must be complete (no deletes
 * sneaking in this way). We rewrite sortOrder by index.
 */
async function reorderRolesAction(orderedIds: string[]) {
  "use server";
  const { session } = await requireSettingsAccess();
  const all = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.companyId, session.companyId));
  const allIds = new Set(all.map((r) => r.id));
  if (orderedIds.length !== all.length) throw new Error("Order must include every role");
  for (const id of orderedIds) {
    if (!allIds.has(id)) throw new Error("Unknown role id");
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(schema.roles).set({ sortOrder: i }).where(eq(schema.roles.id, orderedIds[i]));
  }
  revalidatePath("/manager/settings");
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

  const addOns = await db
    .select()
    .from(schema.addOns)
    .where(eq(schema.addOns.companyId, session.companyId))
    .orderBy(asc(schema.addOns.sortOrder));

  // Event field configs merged with the preset registry so the editor always
  // sees a full row per preset (even if the DB is missing one for some
  // reason) plus all custom fields.
  const savedFieldConfigs = await db
    .select()
    .from(schema.eventFieldConfigs)
    .where(eq(schema.eventFieldConfigs.companyId, session.companyId))
    .orderBy(asc(schema.eventFieldConfigs.sortOrder));
  const savedByKey = new Map(savedFieldConfigs.map((c) => [c.fieldKey, c]));
  const fieldRows: FieldRow[] = [];
  for (const preset of PRESET_FIELDS) {
    const cfg = savedByKey.get(preset.key);
    fieldRows.push({
      fieldKey: preset.key,
      label: preset.label,
      enabled: cfg?.enabled ?? (preset.bucket !== "suggested"),
      required: cfg?.required ?? (preset.bucket === "required"),
      shareWithStaff: cfg?.shareWithStaff ?? (preset.bucket === "required"),
      notifyOnChange: cfg?.notifyOnChange ?? false,
      isCustom: false,
      bucket: preset.bucket,
      lockedEnabled: preset.lockedEnabled,
      lockedRequired: preset.lockedRequired,
    });
  }
  for (const cfg of savedFieldConfigs) {
    if (!cfg.isCustom) continue;
    fieldRows.push({
      fieldKey: cfg.fieldKey,
      label: cfg.label,
      enabled: cfg.enabled,
      required: cfg.required,
      shareWithStaff: cfg.shareWithStaff,
      notifyOnChange: cfg.notifyOnChange,
      isCustom: true,
      bucket: "optional",
    });
  }

  // Banners are scoped per section - a company-setup save doesn't flash a
  // message up under the Roles header and vice versa. Keeps feedback next to
  // the form that caused it.
  const saved = searchParams.saved;
  const err = searchParams.error;
  const errName = searchParams.name ?? "";

  const companySavedMsg = saved === "company" ? "Company setup saved." : null;
  const companyErrorMsg =
    err === "logo-bad-type" ? "Logo must be PNG, JPG, GIF, WebP, or SVG." :
    err === "logo-too-big"  ? "Logo file is too large. Maximum is 1 MB." :
    null;
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

  const addOnsSavedMsg = saved === "addon-added" ? "Add-on added." : null;
  const addOnsErrorMsg =
    err === "addon-duplicate" ? `"${errName}" is already in your list of add-ons.` :
    err === "addon-name-required" ? "Add-on name is required." :
    err === "addon-name-too-long" ? "Add-on name must be 60 characters or fewer." :
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

          <form action={saveCompanySetupAction} className="space-y-5" encType="multipart/form-data">
            <div>
              <label htmlFor="name" className="label">Company name</label>
              <input id="name" name="name" type="text" defaultValue={company.name} required className="input" />
              <p className="text-xs text-gray-500 mt-1">
                Used in the header, email subjects, and email signoffs.
              </p>
            </div>

            <div>
              <label htmlFor="logoFile" className="label">Logo (optional)</label>
              {company.logoUrl && (
                <div className="mb-3 flex items-center gap-3 p-3 border rounded bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={company.logoUrl} alt="current logo" className="h-10 w-10 object-contain rounded bg-white border" />
                  <span className="text-xs text-gray-500 flex-1">Current logo</span>
                  <label className="text-xs text-red-600 hover:underline cursor-pointer inline-flex items-center gap-1">
                    <input type="checkbox" name="removeLogo" className="w-3.5 h-3.5" />
                    Remove on save
                  </label>
                </div>
              )}
              <input
                id="logoFile"
                name="logoFile"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                className="block text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-white file:text-sm file:text-gray-700 hover:file:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">
                PNG, JPG, GIF, WebP, or SVG. Max 1 MB. Appears as a small icon next to the company name
                in the header.
              </p>
            </div>

            <button type="submit" className="btn btn-primary">Save company setup</button>
          </form>

          {companySavedMsg && (
            <div className="mt-4 p-3 border border-green-300 bg-green-50 text-green-800 text-sm rounded">
              {companySavedMsg}
            </div>
          )}
          {companyErrorMsg && (
            <div className="mt-4 p-3 border border-red-300 bg-red-50 text-red-800 text-sm rounded">
              {companyErrorMsg}
            </div>
          )}
        </section>

        {/* -------------------- Notifications -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="text-lg font-semibold mb-3">Notifications</h2>

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

          <RolesList
            initialRoles={roles.map((r) => ({ id: r.id, name: r.name }))}
            onReorder={reorderRolesAction}
            onRemove={removeRoleByIdAction}
          />

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

        {/* -------------------- Event fields -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="text-lg font-semibold mb-1">Event fields</h2>
          <p className="text-sm text-gray-600 mb-4">
            Which fields appear on the event setup page, whether they&apos;re required, which ones go in
            staff invite emails, and which trigger a change notification when edited.
          </p>

          <EventFieldsEditor
            initialRows={fieldRows}
            onSave={saveEventFieldsAction}
            onAddCustom={addCustomEventFieldAction}
          />
        </section>

        {/* -------------------- Add-on tasks -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="text-lg font-semibold mb-1">Add-on tasks</h2>
          <p className="text-sm text-gray-600 mb-4">
            Additional tasks you can tack onto a team member per event (driver/van driver, pick up/drop off,
            video content, etc.). Anything you add here shows up as a toggle on the staff picker when you
            invite people, so you can assign the task to a specific person and set their extra pay.
          </p>

          <AddOnsList
            initialAddOns={addOns.map((a) => ({
              id: a.id,
              name: a.name,
              includeDescription: a.includeDescription,
            }))}
            onReorder={reorderAddOnsAction}
            onRemove={removeAddOnByIdAction}
          />

          <form action={addAddOnAction} className="space-y-3 border-t pt-4">
            <div className="text-sm font-medium">Add a new add-on</div>
            <div>
              <label htmlFor="new-addon-name" className="label">Name</label>
              <input
                id="new-addon-name"
                name="name"
                type="text"
                required
                maxLength={60}
                placeholder="e.g. Van driver, Setup crew, Early arrival"
                className="input"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="includeDescription" className="w-4 h-4" />
              <span>Include a description box on the event page (e.g. for driving directions).</span>
            </label>
            <div>
              <button type="submit" className="btn btn-secondary">Add add-on</button>
            </div>
          </form>

          {addOnsSavedMsg && (
            <div className="mt-4 p-3 border border-green-300 bg-green-50 text-green-800 text-sm rounded">
              {addOnsSavedMsg}
            </div>
          )}
          {addOnsErrorMsg && (
            <div className="mt-4 p-3 border border-red-300 bg-red-50 text-red-800 text-sm rounded">
              {addOnsErrorMsg}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
