import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, makeInviteToken } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { nanoid } from "nanoid";

const POSITION_ROLES = ["Lead", "Bartender", "Bar Back", "Server", "Cashier"] as const;

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
    // Everything else stays NULL — staff fills it via the invite link
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

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Add staff member</h1>
        <p className="text-sm text-gray-600 mb-6">
          Fill in the fields below. The staff member will receive an invite link to set their password and complete
          the rest of their profile (city, phone, date of birth, emergency contact, uniform size).
        </p>

        <form action={addStaffAction} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="First name (as on tax docs)" name="firstName" required />
            <Field label="Last name (as on tax docs)" name="lastName" required />
            <Field label="Email" name="email" type="email" required />
            <div>
              <label className="label" htmlFor="position">Position</label>
              <select id="position" name="position" className="input" required defaultValue="">
                <option value="" disabled>—</option>
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
            <div className="md:col-span-2 flex items-center gap-2 border-t pt-3">
              <input id="canDriveVan" name="canDriveVan" type="checkbox" className="w-4 h-4" />
              <label htmlFor="canDriveVan" className="text-sm">Can drive the van</label>
              <span className="text-xs text-gray-500 ml-2">(gates them out of van-driver invitations if unchecked)</span>
            </div>
          </div>

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
