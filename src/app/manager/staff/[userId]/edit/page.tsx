import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";

const POSITION_ROLES = ["Lead", "Bartender", "Bar Back", "Server", "Cashier"] as const;
const UNIFORM_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;

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

  const phone = str(formData.get("phone"));
  const city = str(formData.get("city"));
  const dateOfBirth = str(formData.get("dateOfBirth"));
  const uniformSize = str(formData.get("uniformSize"));
  const emergencyContactName = str(formData.get("emergencyContactName"));
  const emergencyContactPhone = str(formData.get("emergencyContactPhone"));

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

  // Manager can edit every profile field — staff is still free to update their
  // own personal details via the invite / profile flow.
  await db.update(schema.staffProfiles).set({
    firstName,
    lastName,
    position,
    defaultRate: rate,
    defaultRateType: rateType,
    canDriveVan,
    phone,
    city,
    dateOfBirth,
    uniformSize,
    emergencyContactName,
    emergencyContactPhone,
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
  if (!me) redirect("/login");
  if (!me.isOwner && !me.canAccessStaff) redirect("/manager?denied=staff");

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
              <div className="md:col-span-2 flex items-center gap-2">
                <input id="canDriveVan" name="canDriveVan" type="checkbox" defaultChecked={profile.canDriveVan ?? false} className="w-4 h-4" />
                <label htmlFor="canDriveVan" className="text-sm">Can drive the van</label>
              </div>
            </div>
          </section>

          <section className="pt-6 border-t">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Personal details</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Cell phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} />
              <Field label="City" name="city" defaultValue={profile.city ?? ""} />
              <div>
                <label className="label" htmlFor="dateOfBirth">Date of birth</label>
                <input id="dateOfBirth" name="dateOfBirth" type="date" className="input" defaultValue={profile.dateOfBirth ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="uniformSize">Uniform size</label>
                <select id="uniformSize" name="uniformSize" className="input" defaultValue={profile.uniformSize ?? ""}>
                  <option value="">—</option>
                  {UNIFORM_SIZES.map((s) => (<option key={s} value={s}>{s}</option>))}
                  {/* If staff entered a non-standard size in the past, preserve it as an option */}
                  {profile.uniformSize && !UNIFORM_SIZES.includes(profile.uniformSize as typeof UNIFORM_SIZES[number]) && (
                    <option value={profile.uniformSize}>{profile.uniformSize}</option>
                  )}
                </select>
              </div>
              <Field label="Emergency contact name" name="emergencyContactName" defaultValue={profile.emergencyContactName ?? ""} />
              <Field label="Emergency contact phone" name="emergencyContactPhone" type="tel" defaultValue={profile.emergencyContactPhone ?? ""} />
            </div>
          </section>

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
