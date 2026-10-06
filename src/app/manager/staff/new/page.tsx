import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, makeInviteToken } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { StaffRolesEditor } from "@/components/StaffRolesEditor";
import { nanoid } from "nanoid";

const UNIFORM_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;

async function addStaffAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

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

  // Optional profile fields - manager can prefill if they already know them,
  // otherwise staff fills via the invite link.
  const phone = str(formData.get("phone"));
  const city = str(formData.get("city"));
  const dateOfBirth = str(formData.get("dateOfBirth"));
  const uniformSize = str(formData.get("uniformSize"));
  const emergencyContactName = str(formData.get("emergencyContactName"));
  const emergencyContactPhone = str(formData.get("emergencyContactPhone"));

  if (!firstName || !lastName || !email || roleRows.length === 0) {
    throw new Error("First name, last name, email, and at least one role are required");
  }
  const primary = roleRows[0];

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
    position: primary.role,
    defaultRate: primary.rate,
    defaultRateType: primary.rateType,
    phone,
    city,
    dateOfBirth,
    uniformSize,
    emergencyContactName,
    emergencyContactPhone,
  });

  // Dedupe + persist every role the manager configured. Primary already
  // lives on the profile as a fallback; the real list is here.
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

  redirect("/manager/staff");
}

function str(v: FormDataEntryValue | null): string | null { const s = (v?.toString() ?? "").trim(); return s || null; }

export default async function AddStaffPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  if (!user.isOwner && !user.canAccessStaff) redirect("/manager?denied=staff");

  // Role catalog for this company drives the dropdown in the Roles & rates
  // editor. Falls back to the original hardcoded set when the company
  // hasn't configured its own roles yet.
  const companyRoles = await db.select().from(schema.roles).where(eq(schema.roles.companyId, session.companyId));
  companyRoles.sort((a, b) => a.sortOrder - b.sortOrder);
  const roleOptions = companyRoles.length > 0
    ? companyRoles.map((r) => r.name)
    : ["Lead", "Bartender", "Bar Back", "Server", "Cashier"];

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
            </div>
          </section>

          <section className="pt-6 border-t">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Roles &amp; rates</h2>
            <p className="text-sm text-gray-600 mb-3">
              Add every role this staffer can work and their rate for it. When a shift is set up for
              a given position, the system uses the matching role&apos;s rate automatically.
            </p>
            <StaffRolesEditor roleOptions={roleOptions} initial={[]} />
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
