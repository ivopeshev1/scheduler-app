import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { StaffRolesEditor } from "@/components/StaffRolesEditor";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";


async function saveStaffAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const userId = String(formData.get("userId"));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.companyId !== session.companyId) throw new Error("Not found");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Multi-role list from the StaffRolesEditor component.
  type ParsedRoleRow = { role: string; rate: number; rateType: "hourly" | "flat" };
  const roleRows: ParsedRoleRow[] = (() => {
    try {
      const raw = JSON.parse(String(formData.get("staffRoles") ?? "[]"));
      if (!Array.isArray(raw)) return [];
      return raw
        .map((r: unknown): ParsedRoleRow | null => {
          if (!r || typeof r !== "object") return null;
          const o = r as Record<string, unknown>;
          const role = typeof o.role === "string" ? o.role.trim() : "";
          const rateStr = typeof o.rate === "string" ? o.rate : typeof o.rate === "number" ? String(o.rate) : "";
          const rateNum = Number(rateStr);
          const rateType = o.rateType === "flat" ? "flat" : "hourly";
          if (!role || !Number.isFinite(rateNum) || rateNum < 0) return null;
          return { role, rate: rateNum, rateType };
        })
        .filter((r: ParsedRoleRow | null): r is ParsedRoleRow => r !== null);
    } catch {
      return [];
    }
  })();
  if (!firstName || !lastName || !email || roleRows.length === 0) {
    throw new Error("First name, last name, email, and at least one role are required");
  }

  // Primary role for the single-position fallback fields on
  // staff_profiles. The first row is treated as primary.
  const primary = roleRows[0];

  // If email changed, check for duplicates
  if (email !== user.email) {
    const dup = await db.select().from(schema.users).where(
      and(eq(schema.users.companyId, session.companyId), eq(schema.users.email, email)),
    );
    if (dup.length > 0) throw new Error(`A user with email ${email} already exists`);
  }

  await db.update(schema.users).set({ email }).where(eq(schema.users.id, userId));

  // Manager can edit every profile field - staff is still free to update their
  // own personal details via the invite / profile flow.
  await db.update(schema.staffProfiles).set({
    firstName,
    lastName,
    position: primary.role,
    defaultRate: primary.rate,
    defaultRateType: primary.rateType,
  }).where(eq(schema.staffProfiles.userId, userId));

  // Replace-style sync of staff_roles. Simplest + safest for a small
  // list: delete every existing row then insert what the form sent.
  await db.delete(schema.staffRoles).where(eq(schema.staffRoles.userId, userId));
  // Dedupe by role (first occurrence wins) so a double-entry doesn't
  // trip the unique index.
  const seen = new Set<string>();
  for (const r of roleRows) {
    if (seen.has(r.role)) continue;
    seen.add(r.role);
    await db.insert(schema.staffRoles).values({
      id: nanoid(),
      userId,
      role: r.role,
      rate: r.rate,
      rateType: r.rateType,
    });
  }

  revalidatePath("/manager/staff");
  redirect("/manager/staff");
}

function num(v: FormDataEntryValue | null): number | null { const s = v?.toString().trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }

export default async function EditStaffPage({ params }: { params: { userId: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, params.userId));
  if (!target || target.companyId !== session.companyId || target.role !== "staff") notFound();
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, params.userId));
  if (!profile) notFound();

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me) redirect("/login");
  if (!me.isOwner && !me.canAccessStaff) redirect("/manager?denied=staff");

  // Role catalog for the company drives both the per-role dropdown and
  // the staff-profile position fallback. Fall back to a hardcoded set
  // when no company roles are configured yet.
  const companyRoles = await db.select().from(schema.roles).where(eq(schema.roles.companyId, session.companyId));
  companyRoles.sort((a, b) => a.sortOrder - b.sortOrder);
  const roleOptions = companyRoles.length > 0
    ? companyRoles.map((r) => r.name)
    : ["Lead", "Bartender", "Bar Back", "Server", "Cashier"];

  // Existing per-role rates for this staffer (seeded by the migration
  // backfill from their old position+defaultRate pair when present).
  const existingRoles = await db.select().from(schema.staffRoles).where(eq(schema.staffRoles.userId, params.userId));
  const initialRoleRows = existingRoles.length > 0
    ? existingRoles.map((r) => ({
        role: r.role,
        rate: String(r.rate),
        rateType: r.rateType as "hourly" | "flat",
      }))
    : [{
        role: profile.position ?? roleOptions[0] ?? "",
        rate: profile.defaultRate != null ? String(profile.defaultRate) : "",
        rateType: (profile.defaultRateType === "flat" ? "flat" : "hourly") as "hourly" | "flat",
      }];

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={me.email} role="manager" logoUrl={company.logoUrl} isOwner={!!me.isOwner} canAccessCalendar={!!me.canAccessCalendar} canAccessStaff={!!me.canAccessStaff} canAccessLog={!!me.canAccessLog} canAccessTeam={!!me.canAccessTeam} canEditSettings={!!me.canEditSettings} />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Modify {profile.firstName} {profile.lastName}</h1>
        <p className="text-sm text-gray-600 mb-6">
          Update any field. Personal details can also be edited by the staff member themselves
          from their account.
        </p>

        <form action={saveStaffAction} className="space-y-4">
          <input type="hidden" name="userId" value={target.id} />

          <section>
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Required</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="First name" name="firstName" defaultValue={profile.firstName} required />
              <Field label="Last name" name="lastName" defaultValue={profile.lastName} required />
              <Field label="Email" name="email" type="email" defaultValue={target.email} required />
            </div>
          </section>

          <section className="pt-6 border-t">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Roles &amp; rates</h2>
            <p className="text-sm text-gray-600 mb-3">
              Each role this staffer can work and what they earn in that role. When a shift is set
              up for a given position, the system uses the matching role&apos;s rate automatically.
            </p>
            <StaffRolesEditor roleOptions={roleOptions} initial={initialRoleRows} />
          </section>

          {(profile.phone || profile.city || profile.dateOfBirth || profile.uniformSize || profile.emergencyContactName || profile.emergencyContactPhone) && (
            <section className="pt-6 border-t">
              <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Staffer-provided details</h2>
              <p className="text-sm text-gray-500 mb-3">
                These were filled in by the staffer during onboarding. Managers can view them but
                not edit here - the staffer updates them from their own account.
              </p>
              <dl className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {profile.phone && (<><dt className="text-gray-500">Cell phone</dt><dd>{profile.phone}</dd></>)}
                {profile.city && (<><dt className="text-gray-500">Current city</dt><dd>{profile.city}</dd></>)}
                {profile.dateOfBirth && (<><dt className="text-gray-500">Date of birth</dt><dd>{profile.dateOfBirth}</dd></>)}
                {profile.uniformSize && (<><dt className="text-gray-500">Shirt size</dt><dd>{profile.uniformSize}</dd></>)}
                {profile.emergencyContactName && (<><dt className="text-gray-500">Emergency contact</dt><dd>{profile.emergencyContactName}</dd></>)}
                {profile.emergencyContactPhone && (<><dt className="text-gray-500">Emergency phone</dt><dd>{profile.emergencyContactPhone}</dd></>)}
              </dl>
            </section>
          )}

          <div className="flex gap-3 pt-6 border-t">
            <button type="submit" className="btn btn-primary">Save changes</button>
            <Link href="/manager/staff" className="btn btn-secondary">Cancel</Link>
          </div>
        </form>
      </main>
    </div>
  );
}

function Field({ label, name, type = "text", required, defaultValue }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} className="input" />
    </div>
  );
}
