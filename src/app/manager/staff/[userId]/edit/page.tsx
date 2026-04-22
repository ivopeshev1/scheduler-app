import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";

const POSITION_ROLES = ["Lead", "Bartender", "Bar Back", "Server", "Cashier"] as const;

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
  const position = String(formData.get("position") ?? "").trim() as typeof POSITION_ROLES[number];
  const rate = num(formData.get("defaultRate"));
  const rateType = (str(formData.get("defaultRateType")) ?? "hourly") as "hourly" | "flat" | "both";
  const canDriveVan = formData.get("canDriveVan") === "on";

  if (!firstName || !lastName || !email || !position || rate === null) {
    throw new Error("First name, last name, email, position, and rate are required");
  }

  // If email changed, check for duplicates
  if (email !== user.email) {
    const dup = await db.select().from(schema.users).where(
      and(eq(schema.users.companyId, session.companyId), eq(schema.users.email, email)),
    );
    if (dup.length > 0) throw new Error(`A user with email ${email} already exists`);
  }

  await db.update(schema.users).set({ email }).where(eq(schema.users.id, userId));

  // Update required profile fields only — optional fields remain the staff's to edit
  await db.update(schema.staffProfiles).set({
    firstName,
    lastName,
    position,
    defaultRate: rate,
    defaultRateType: rateType,
    canDriveVan,
  }).where(eq(schema.staffProfiles.userId, userId));

  revalidatePath("/manager/staff");
  redirect("/manager/staff");
}

function str(v: FormDataEntryValue | null): string | null { const s = (v?.toString() ?? "").trim(); return s || null; }
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

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={me.email} role="manager" logoUrl={company.logoUrl} isOwner={!!me.isOwner} canEditSettings={!!me.canEditSettings} />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Modify {profile.firstName} {profile.lastName}</h1>
        <p className="text-sm text-gray-600 mb-6">
          You can update the manager-set fields below. Personal details (city, phone, DOB, emergency contact, uniform)
          are the staff member's to edit themselves.
        </p>

        <form action={saveStaffAction} className="space-y-4">
          <input type="hidden" name="userId" value={target.id} />
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="First name" name="firstName" defaultValue={profile.firstName} required />
            <Field label="Last name" name="lastName" defaultValue={profile.lastName} required />
            <Field label="Email" name="email" type="email" defaultValue={target.email} required />
            <div>
              <label className="label" htmlFor="position">Position</label>
              <select id="position" name="position" className="input" required defaultValue={profile.position}>
                {POSITION_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="defaultRate">Default rate ($)</label>
              <input id="defaultRate" name="defaultRate" type="number" min={0} step="0.01" className="input" defaultValue={profile.defaultRate ?? ""} required />
            </div>
            <div>
              <label className="label" htmlFor="defaultRateType">Rate type</label>
              <select id="defaultRateType" name="defaultRateType" className="input" defaultValue={profile.defaultRateType ?? "hourly"}>
                <option value="hourly">Hourly</option>
                <option value="flat">Flat</option>
                <option value="both">Both (depends on event)</option>
              </select>
            </div>
            <div className="md:col-span-2 flex items-center gap-2 border-t pt-3">
              <input id="canDriveVan" name="canDriveVan" type="checkbox" defaultChecked={profile.canDriveVan ?? false} className="w-4 h-4" />
              <label htmlFor="canDriveVan" className="text-sm">Can drive the van</label>
            </div>
          </div>

          {/* Read-only view of staff-managed fields */}
          <div className="pt-6 border-t">
            <h3 className="font-semibold text-sm uppercase text-gray-500 mb-3">Staff-managed (read-only)</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <ReadOnly label="City" value={profile.city} />
              <ReadOnly label="Cell phone" value={profile.phone} />
              <ReadOnly label="Date of birth" value={profile.dateOfBirth} />
              <ReadOnly label="Uniform size" value={profile.uniformSize} />
              <ReadOnly label="Emergency contact name" value={profile.emergencyContactName} />
              <ReadOnly label="Emergency contact phone" value={profile.emergencyContactPhone} />
            </div>
          </div>

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

function ReadOnly({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-gray-800">{value ?? <span className="text-gray-300">Not filled yet</span>}</div>
    </div>
  );
}
