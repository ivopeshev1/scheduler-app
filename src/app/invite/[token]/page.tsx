import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { createSession, hashPassword } from "@/lib/auth";
import { ProfilePhotoField } from "@/components/ProfilePhotoField";
import { PasswordInput } from "@/components/PasswordInput";
import { checkOnboardInvite, validateOnboardForm } from "@/lib/staff-onboarding";

/**
 * Staff onboarding landing page. Reached by every freshly-added staffer
 * via the /invite/<token> link in the welcome email their manager
 * generates. First visit = pick a password + fill in the personal
 * details the manager-side Add Staff form didn't collect (phone, DOB,
 * emergency contact, uniform, photo). On successful submit we stamp
 * invite_accepted_at + password_hash, insert / update the staff profile,
 * drop them into a logged-in session, and redirect to /staff.
 *
 * Repeat clicks of the same link after onboarding redirect to /login so
 * the token isn't a backdoor into the account.
 */

async function finishOnboardingAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const [target] = await db.select().from(schema.users).where(eq(schema.users.inviteToken, token));
  if (!target || target.inviteAcceptedAt || target.suspendedAt || target.archivedAt) {
    redirect("/login");
  }

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();
  const dob = String(formData.get("dob") ?? "").trim();
  const emergencyName = String(formData.get("emergencyName") ?? "").trim();
  const emergencyPhone = String(formData.get("emergencyPhone") ?? "").trim();
  const uniformSize = String(formData.get("uniformSize") ?? "").trim() || null;
  const photoUrl = String(formData.get("photoUrl") ?? "").trim() || null;

  const err = validateOnboardForm({
    password,
    confirm,
    phone,
    dob,
    emergencyName,
    emergencyPhone,
  });
  if (err) {
    redirect(`/invite/${token}?err=${encodeURIComponent(err)}`);
  }

  await db
    .update(schema.users)
    .set({
      passwordHash: hashPassword(password),
      inviteAcceptedAt: new Date(),
      inviteToken: null, // one-time use; stops a leaked URL from re-onboarding later
    })
    .where(eq(schema.users.id, target.id));

  // Update the profile row the manager pre-created. We never insert a
  // fresh profile here because the manager-side Add Staff flow already
  // did (name + position + rates), and we don't want to blow those away.
  await db
    .update(schema.staffProfiles)
    .set({ phone, dateOfBirth: dob, emergencyContactName: emergencyName, emergencyContactPhone: emergencyPhone, uniformSize, photoUrl })
    .where(eq(schema.staffProfiles.userId, target.id));

  await createSession({ userId: target.id, companyId: target.companyId, role: target.role });
  redirect("/staff?welcome=1");
}

export default async function StaffOnboardPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { err?: string };
}) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.inviteToken, params.token));
  const check = checkOnboardInvite({
    userExists: !!user,
    isSuspended: !!user?.suspendedAt,
    isArchived: !!user?.archivedAt,
    isOnboarded: !!user?.inviteAcceptedAt,
  });

  if (!check.ok) {
    const [headline, body, cta] =
      check.reason === "unknown"
        ? [
            "Link not recognized",
            "This invite link isn't valid. If you got it from a manager at your staffing company, ask them to resend the link.",
            null,
          ]
        : check.reason === "suspended"
        ? [
            "Account suspended",
            "Your account has been suspended by the owner. Reach out to them directly to get it reactivated.",
            null,
          ]
        : check.reason === "archived"
        ? [
            "Account removed",
            "This account has been removed. If you believe that's a mistake, contact your manager.",
            null,
          ]
        : [
            "You're already set up",
            "This account has already been onboarded. Log in with the email + password you created.",
            { href: "/login", label: "Go to login" } as const,
          ];
    return (
      <main className="max-w-md mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">{headline}</h1>
        <p className="text-gray-600 mt-3">{body}</p>
        {cta && (
          <Link href={cta.href} className="btn btn-primary mt-6 inline-flex">
            {cta.label}
          </Link>
        )}
      </main>
    );
  }

  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, user!.id));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, user!.companyId));
  const companyName = company?.name ?? "Scheduler";
  const errMessage = searchParams.err;

  return (
    <main className="max-w-xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-semibold">Welcome to {companyName}</h1>
      <p className="text-gray-600 mt-2">
        Hi {profile?.firstName ?? "there"} — your manager at {companyName} set up your account.
        Finish the few details below and you&apos;re in.
      </p>

      <form action={finishOnboardingAction} className="mt-8 space-y-5">
        <input type="hidden" name="token" value={params.token} />

        {errMessage && (
          <div className="border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">
            {errMessage}
          </div>
        )}

        {/* -------- Your info (confirm) -------- */}
        <section className="border rounded-lg bg-white p-5 space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Your info</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label text-sm">Name</label>
              <div className="input bg-gray-50 cursor-not-allowed">
                {profile?.firstName} {profile?.lastName}
              </div>
            </div>
            <div>
              <label className="label text-sm">Email</label>
              <div className="input bg-gray-50 cursor-not-allowed">{user!.email}</div>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Name + email are set by your manager. Reach out to them if either needs to change.
          </p>
        </section>

        {/* -------- Password -------- */}
        <section className="border rounded-lg bg-white p-5 space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Pick a password</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="password" className="label text-sm">Password <span className="text-red-500">*</span></label>
              <PasswordInput id="password" name="password" required minLength={8} autoComplete="new-password" />
              <p className="text-xs text-gray-500 mt-1">At least 8 characters.</p>
            </div>
            <div>
              <label htmlFor="confirm" className="label text-sm">Confirm password <span className="text-red-500">*</span></label>
              <PasswordInput id="confirm" name="confirm" required minLength={8} autoComplete="new-password" />
            </div>
          </div>
        </section>

        {/* -------- Contact info -------- */}
        <section className="border rounded-lg bg-white p-5 space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Contact info</h2>
          <div>
            <label htmlFor="phone" className="label text-sm">Phone <span className="text-red-500">*</span></label>
            <input id="phone" name="phone" type="tel" required defaultValue={profile?.phone ?? ""} placeholder="(555) 555-5555" className="input" />
            <p className="text-xs text-gray-500 mt-1">We use this for shift reminders and urgent updates. SMS support coming soon.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="dob" className="label text-sm">Date of birth <span className="text-red-500">*</span></label>
              <input id="dob" name="dob" type="date" required defaultValue={profile?.dateOfBirth ?? ""} className="input" />
              <p className="text-xs text-gray-500 mt-1">Required so your manager can confirm you&apos;re old enough for 21+ roles.</p>
            </div>
            <div>
              <label htmlFor="uniformSize" className="label text-sm">Uniform size</label>
              <select id="uniformSize" name="uniformSize" defaultValue={profile?.uniformSize ?? ""} className="input">
                <option value="">Prefer not to say</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
                <option value="XXL">XXL</option>
              </select>
            </div>
          </div>
        </section>

        {/* -------- Emergency contact -------- */}
        <section className="border rounded-lg bg-white p-5 space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Emergency contact
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="emergencyName" className="label text-sm">Name <span className="text-red-500">*</span></label>
              <input id="emergencyName" name="emergencyName" required defaultValue={profile?.emergencyContactName ?? ""} className="input" />
            </div>
            <div>
              <label htmlFor="emergencyPhone" className="label text-sm">Phone <span className="text-red-500">*</span></label>
              <input id="emergencyPhone" name="emergencyPhone" type="tel" required defaultValue={profile?.emergencyContactPhone ?? ""} className="input" />
            </div>
          </div>
        </section>

        {/* -------- Profile photo -------- */}
        <section className="border rounded-lg bg-white p-5 space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Profile photo
          </h2>
          <p className="text-sm text-gray-600">
            Optional. Shows up as your avatar across the app so your manager + teammates can put a face to the name.
          </p>
          <ProfilePhotoField initialDataUrl={profile?.photoUrl ?? null} />
        </section>

        <div className="pt-2">
          <button type="submit" className="btn btn-primary w-full justify-center">
            Finish setup &amp; log in
          </button>
        </div>
      </form>
    </main>
  );
}
