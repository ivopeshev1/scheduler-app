import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, makeInviteToken } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { nanoid } from "nanoid";

const POSITION_ROLES = ["Lead", "Bartender", "Bar Back", "Server", "Cashier"] as const;
const UNIFORM_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;

async function addStaffAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const position = String(formData.get("position") ?? "").trim() as typeof POSITION_ROLES[number];
  const rate = num(formData.get("defaultRate"));
  const rateType = (str(formData.get("defaultRateType")) ?? "hourly") as "hourly" | "flat" | "both";
  const canDriveVan = formData.get("canDriveVan") === "on";

  // Optional profile fields - manager can prefill if they already know them,
  // otherwise staff fills via the invite link.
  const phone = str(formData.get("phone"));
  const city = str(formData.get("city"));
  const dateOfBirth = str(formData.get("dateOfBirth"));
  const uniformSize = str(formData.get("uniformSize"));
  const emergencyContactName = str(formData.get("emergencyContactName"));
  const emergencyContactPhone = str(formData.get("emergencyContactPhone"));

  if (!firstName || !lastName || !email || !position || rate === null) {
    throw new Error("First name, last name, email, position, and rate are required");
  }

  const existing = await db.select().from(schema.users).where(
    and(eq(schema.users.companyId, session.companyId), eq(schema.users.email, email)),
  );
  if (existing.length > 0) {
    throw new Error(`A user with email ${email} already exists in your company`);
  }

  const userId = nanoid();
  const inviteToken = makeInviteToken();
  await db.insert(schema.users).values({
    id: userId,
    companyId: session.companyId,
    email,
    role: "staff",
    inviteToken,
  });

  await db.insert(schema.staffProfiles).values({
    userId,
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
  });

  redirect("/manager/staff");
}

function str(v: FormDataEntryValue | null): string | null { const s = (v?.toString() ?? "").trim(); return s || null; }
function num(v: FormDataEntryValue | null): number | null { const s = v?.toString().trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }

export default async function AddStaffPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  if (!user.isOwner && !user.canAccessStaff) redirect("/manager?denied=staff");

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Add staff member</h1>
        <p className="text-sm text-gray-600 mb-6">
          Fields below the divider are optional - fill in what you already know; anything left blank
          the staff member can complete themselves via the invite link.
        </p>

        <form action={addStaffAction} className="space-y-4">
          <section>
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Required</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="First name (as on tax docs)" name="firstName" required />
              <Field label="Last name (as on tax docs)" name="lastName" required />
              <Field label="Email" name="email" type="email" required />
              <div>
                <label className="label" htmlFor="position">Position</label>
                <select id="position" name="position" className="input" required defaultValue="">
                  <option value="" disabled>-</option>
                  {POSITION_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="defaultRate">Default rate ($)</label>
                <input id="defaultRate" name="defaultRate" type="number" min={0} step="0.01" className="input" required />
              </div>
              <div>
                <label className="label" htmlFor="defaultRateType">Rate type</label>
                <select id="defaultRateType" name="defaultRateType" className="input" defaultValue="hourly">
                  <option value="hourly">Hourly</option>
                  <option value="flat">Flat</option>
                  <option value="both">Both (depends on event)</option>
                </select>
              </div>
              <div className="md:col-span-2 flex items-center gap-2">
                <input id="canDriveVan" name="canDriveVan" type="checkbox" className="w-4 h-4" />
                <label htmlFor="canDriveVan" className="text-sm">Can drive the van</label>
                <span className="text-xs text-gray-500 ml-2">(gates them out of van-driver invitations if unchecked)</span>
              </div>
            </div>
          </section>

          <section className="pt-6 border-t">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Personal details (optional)</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Cell phone" name="phone" type="tel" />
              <Field label="City" name="city" />
              <div>
                <label className="label" htmlFor="dateOfBirth">Date of birth</label>
                <input id="dateOfBirth" name="dateOfBirth" type="date" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="uniformSize">Uniform size</label>
                <select id="uniformSize" name="uniformSize" className="input" defaultValue="">
                  <option value="">-</option>
                  {UNIFORM_SIZES.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
              <Field label="Emergency contact name" name="emergencyContactName" />
              <Field label="Emergency contact phone" name="emergencyContactPhone" type="tel" />
            </div>
          </section>

          <div className="flex gap-3 pt-4 border-t">
            <button type="submit" className="btn btn-primary">Add staff</button>
            <Link href="/manager/staff" className="btn btn-secondary">Cancel</Link>
          </div>
        </form>
      </main>
    </div>
  );
}

function Field({ label, name, type = "text", required }: {
  label: string; name: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} className="input" />
    </div>
  );
}
