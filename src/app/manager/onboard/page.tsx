import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { ProfilePhotoField } from "@/components/ProfilePhotoField";
import { revalidatePath } from "next/cache";

/**
 * Signup wizard. Runs on first login until the owner finishes all 3 steps:
 *   1. Company — logo, industry, timezone/country/currency, address, brand color
 *   2. Owner profile — name, phone, city, photo
 *   3. Operational defaults — pay period cadence/anchor, on-call standby fee
 *
 * URL-driven: ?step=1|2|3. Each step saves on submit and advances. The final
 * step stamps companies.onboarded_at so the manager layout stops forcing
 * this page.
 */

const INDUSTRIES = [
  "Catering & bar programs",
  "Hotel & hospitality",
  "Restaurant staffing",
  "Event & conference",
  "Security",
  "Cleaning & janitorial",
  "Healthcare & senior care",
  "Construction",
  "Retail",
  "Other",
];

const TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

async function saveCompanyAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner) throw new Error("Only the owner can set company details");

  const logoUrl = String(formData.get("logoUrl") ?? "").trim() || null;
  const industry = String(formData.get("industry") ?? "").trim() || null;
  const timezone = String(formData.get("timezone") ?? "").trim() || null;
  const country = String(formData.get("country") ?? "").trim() || null;
  const currency = String(formData.get("currency") ?? "USD").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const brandColor = String(formData.get("brandColor") ?? "").trim() || null;

  await db
    .update(schema.companies)
    .set({ logoUrl, industry, timezone, country, currency, address, brandColor })
    .where(eq(schema.companies.id, session.companyId));
  revalidatePath("/manager/onboard");
  redirect("/manager/onboard?step=2");
}

async function saveProfileAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const photoUrl = String(formData.get("photoUrl") ?? "").trim() || null;
  if (!firstName || !lastName) throw new Error("First and last name are required");

  const [existing] = await db
    .select()
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, session.userId));
  if (existing) {
    await db
      .update(schema.managerProfiles)
      .set({ firstName, lastName, phone, city, photoUrl })
      .where(eq(schema.managerProfiles.userId, session.userId));
  } else {
    await db.insert(schema.managerProfiles).values({
      userId: session.userId,
      firstName, lastName, phone, city, photoUrl,
    });
  }
  revalidatePath("/manager/onboard");
  redirect("/manager/onboard?step=3");
}

async function saveDefaultsAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner) throw new Error("Only the owner can set these defaults");

  const cadence = String(formData.get("payPeriodCadence") ?? "weekly") as "weekly" | "biweekly" | "monthly";
  const anchor = String(formData.get("payPeriodAnchor") ?? "").trim() || null;
  const feeRaw = String(formData.get("onCallFee") ?? "").trim();
  const onCallFee = feeRaw ? Number(feeRaw) : null;

  await db
    .update(schema.companies)
    .set({
      payPeriodCadence: cadence,
      payPeriodAnchor: anchor,
      onCallFee: Number.isFinite(onCallFee!) ? onCallFee : null,
      onboardedAt: new Date(),
    })
    .where(eq(schema.companies.id, session.companyId));
  revalidatePath("/manager");
  redirect("/manager?welcome=1");
}

async function saveProfileOnlyAction(formData: FormData) {
  "use server";
  // Used after onboarding is complete, for later profile edits from the
  // header avatar link. Keeps editing simple without re-walking the wizard.
  await saveProfileAction(formData);
}

export default async function OnboardPage({ searchParams }: { searchParams: { step?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");

  const [profile] = await db
    .select()
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, session.userId));

  // Non-owners don't walk the company steps. They just set up their own
  // profile and go. (Owner wizard touches company-level fields that
  // non-owners aren't allowed to change.)
  const wizardMode = !!user.isOwner && !company.onboardedAt;
  const step = Number(searchParams.step ?? "1");

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} canAccessPayroll={!!user.canAccessPayroll} />
      <main className="max-w-xl mx-auto px-6 py-10">
        {wizardMode ? (
          <>
            <WizardProgress step={step} />
            {step <= 1 && <CompanyStep company={company} />}
            {step === 2 && <ProfileStep profile={profile ?? null} companyName={company.name} />}
            {step >= 3 && <DefaultsStep company={company} />}
          </>
        ) : (
          <ProfileStep profile={profile ?? null} companyName={company.name} editOnly />
        )}
      </main>
    </div>
  );
}

function WizardProgress({ step }: { step: number }) {
  const steps = ["Company", "Your profile", "Defaults"];
  return (
    <div className="flex items-center justify-between mb-8 text-xs">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <div key={label} className="flex items-center flex-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold ${
                done ? "bg-green-500 text-white" : active ? "bg-black text-white" : "bg-gray-200 text-gray-500"
              }`}
            >
              {done ? "✓" : n}
            </div>
            <div className={`ml-2 ${active ? "font-semibold" : "text-gray-500"}`}>{label}</div>
            {i < steps.length - 1 && <div className="flex-1 border-t border-gray-200 mx-3" />}
          </div>
        );
      })}
    </div>
  );
}

function CompanyStep({ company }: { company: typeof schema.companies.$inferSelect }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Set up {company.name}</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">A few details so the app knows where and how you work. You can change any of this later in Settings.</p>
      <form action={saveCompanyAction} className="space-y-5">
        <LogoField initialDataUrl={company.logoUrl ?? null} />
        <div>
          <label htmlFor="industry" className="label">Industry</label>
          <select id="industry" name="industry" defaultValue={company.industry ?? ""} className="input">
            <option value="">Pick one…</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="timezone" className="label">Timezone</label>
            <select id="timezone" name="timezone" defaultValue={company.timezone ?? "America/Los_Angeles"} className="input">
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="country" className="label">Country</label>
            <input id="country" name="country" defaultValue={company.country ?? "United States"} className="input" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="currency" className="label">Currency</label>
            <select id="currency" name="currency" defaultValue={company.currency ?? "USD"} className="input">
              {["USD","CAD","EUR","GBP","AUD","MXN"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="brandColor" className="label">Brand color (optional)</label>
            <input id="brandColor" name="brandColor" type="color" defaultValue={company.brandColor ?? "#111827"} className="input h-10 p-1" />
          </div>
        </div>
        <div>
          <label htmlFor="address" className="label">Business address (optional)</label>
          <input id="address" name="address" defaultValue={company.address ?? ""} placeholder="123 Main St, City, State" className="input" />
        </div>
        <div className="pt-2 flex justify-end">
          <button type="submit" className="btn btn-primary">Next: Your profile</button>
        </div>
      </form>
    </section>
  );
}

function ProfileStep({ profile, companyName, editOnly }: { profile: typeof schema.managerProfiles.$inferSelect | null; companyName: string; editOnly?: boolean }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">
        {editOnly ? "Your profile" : `Welcome to ${companyName}`}
      </h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">
        {editOnly
          ? "Update your name, contact info, or photo. Changes show up right away in the header."
          : "Set up your profile so the team knows who you are. Your photo becomes your avatar."}
      </p>
      <form action={editOnly ? saveProfileOnlyAction : saveProfileAction} className="space-y-5">
        <ProfilePhotoField initialDataUrl={profile?.photoUrl ?? null} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className="label">First name <span className="text-red-500">*</span></label>
            <input id="firstName" name="firstName" required defaultValue={profile?.firstName ?? ""} className="input" />
          </div>
          <div>
            <label htmlFor="lastName" className="label">Last name <span className="text-red-500">*</span></label>
            <input id="lastName" name="lastName" required defaultValue={profile?.lastName ?? ""} className="input" />
          </div>
        </div>
        <div>
          <label htmlFor="phone" className="label">Phone (optional)</label>
          <input id="phone" name="phone" type="tel" defaultValue={profile?.phone ?? ""} className="input" placeholder="(555) 555-5555" />
        </div>
        <div>
          <label htmlFor="city" className="label">City (optional)</label>
          <input id="city" name="city" defaultValue={profile?.city ?? ""} className="input" />
        </div>
        <div className="pt-2 flex justify-between items-center">
          {!editOnly && (
            <Link href="/manager/onboard?step=1" className="text-sm text-gray-500 hover:underline">← Back</Link>
          )}
          <button type="submit" className="btn btn-primary ml-auto">
            {editOnly ? "Save changes" : "Next: Defaults"}
          </button>
        </div>
      </form>
    </section>
  );
}

function DefaultsStep({ company }: { company: typeof schema.companies.$inferSelect }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Pay period &amp; on-call defaults</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">How often you run payroll and your standby fee. These feed the Payroll tab and the on-call shift workflow — tweak later in Settings any time.</p>
      <form action={saveDefaultsAction} className="space-y-5">
        <div>
          <label htmlFor="payPeriodCadence" className="label">Pay period cadence</label>
          <select id="payPeriodCadence" name="payPeriodCadence" defaultValue={company.payPeriodCadence ?? "weekly"} className="input">
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label htmlFor="payPeriodAnchor" className="label">Anchor date</label>
          <input id="payPeriodAnchor" name="payPeriodAnchor" type="date" defaultValue={company.payPeriodAnchor ?? ""} className="input" />
          <p className="text-xs text-gray-500 mt-1">The reference date each pay period starts on (any Monday for weekly, etc.).</p>
        </div>
        <div>
          <label htmlFor="onCallFee" className="label">On-call standby fee ($)</label>
          <input id="onCallFee" name="onCallFee" type="number" step="0.01" defaultValue={company.onCallFee ?? ""} className="input" placeholder="e.g. 50" />
          <p className="text-xs text-gray-500 mt-1">What you pay a staffer who sits on standby, whether or not they get called in. Leave blank if you don&apos;t use on-call.</p>
        </div>
        <div className="pt-2 flex justify-between items-center">
          <Link href="/manager/onboard?step=2" className="text-sm text-gray-500 hover:underline">← Back</Link>
          <button type="submit" className="btn btn-primary">Finish setup</button>
        </div>
      </form>
    </section>
  );
}

/**
 * Logo picker — same base64 pattern as ProfilePhotoField but larger
 * preview (square) and labeled for company branding.
 */
function LogoField({ initialDataUrl }: { initialDataUrl: string | null }) {
  return (
    <div>
      <label className="label">Company logo (optional)</label>
      <ProfilePhotoField initialDataUrl={initialDataUrl} name="logoUrl" />
      <p className="text-xs text-gray-500 mt-1">Shows in the top-left of the app and on every email you send to staff.</p>
    </div>
  );
}
