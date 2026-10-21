import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hashPassword } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { validateNewPassword } from "@/lib/password-reset";
import { ProfilePhotoField } from "@/components/ProfilePhotoField";

/**
 * Personal settings for a signed-in staffer. Covers everything they
 * entered during onboarding plus the password. Name + email are
 * manager-controlled (changing those requires asking the manager), so
 * they render as read-only here.
 */

async function saveProfileAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");

  const phone = String(formData.get("phone") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim() || null;
  const dob = String(formData.get("dob") ?? "").trim() || null;
  const emergencyName = String(formData.get("emergencyName") ?? "").trim();
  const emergencyPhone = String(formData.get("emergencyPhone") ?? "").trim();
  const uniformSize = String(formData.get("uniformSize") ?? "").trim() || null;
  const photoUrl = String(formData.get("photoUrl") ?? "").trim() || null;

  if (!phone) redirect("/staff/settings?err=phone");
  if (!emergencyName || !emergencyPhone) redirect("/staff/settings?err=emergency");

  await db
    .update(schema.staffProfiles)
    .set({
      phone,
      city,
      dateOfBirth: dob,
      emergencyContactName: emergencyName,
      emergencyContactPhone: emergencyPhone,
      uniformSize,
      photoUrl,
    })
    .where(eq(schema.staffProfiles.userId, session.userId));
  revalidatePath("/staff/settings");
  redirect("/staff/settings?saved=profile");
}

async function changePasswordAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next !== confirm) redirect("/staff/settings?err=mismatch");
  const pwErr = validateNewPassword(next);
  if (pwErr) redirect(`/staff/settings?err=${encodeURIComponent(pwErr)}`);

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user?.passwordHash) redirect("/staff/settings?err=no-password");
  if (!bcrypt.compareSync(current, user.passwordHash!)) {
    redirect("/staff/settings?err=current-wrong");
  }

  await db
    .update(schema.users)
    .set({ passwordHash: hashPassword(next) })
    .where(eq(schema.users.id, session.userId));
  redirect("/staff/settings?saved=password");
}

export default async function StaffSettingsPage({
  searchParams,
}: {
  searchParams: { err?: string; saved?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "staff") redirect("/manager");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));

  const err = searchParams.err;
  const errMessage =
    !err ? null
    : err === "phone" ? "Phone number is required."
    : err === "emergency" ? "Both emergency contact name and phone are required."
    : err === "mismatch" ? "The new password and confirmation don't match."
    : err === "current-wrong" ? "Current password is incorrect."
    : err === "no-password" ? "This account doesn't have a password set yet."
    : err;
  const savedProfile = searchParams.saved === "profile";
  const savedPassword = searchParams.saved === "password";

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" logoUrl={company.logoUrl} />
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <div>
          <Link href="/staff" className="text-sm text-gray-500 hover:underline">← Back to my shifts</Link>
          <h1 className="text-2xl font-semibold mt-2">My settings</h1>
          <p className="text-sm text-gray-600 mt-1">
            Personal account details for <strong>{profile?.firstName} {profile?.lastName}</strong>.
            Need your name or email changed? Message your manager at {company.name}.
          </p>
        </div>

        {errMessage && (
          <div className="border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">{errMessage}</div>
        )}

        {/* -------------------- Profile -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1">Profile</h2>
          <p className="text-sm text-gray-600 mb-5">
            How your manager and the system reach you. The phone + emergency contact
            are required so your manager can get a hold of you (or someone close to you)
            if something comes up on event day.
          </p>
          <form action={saveProfileAction} className="space-y-5">
            {/* Read-only basics */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Name</label>
                <div className="input bg-gray-50 cursor-not-allowed">
                  {profile?.firstName} {profile?.lastName}
                </div>
              </div>
              <div>
                <label className="label">Email</label>
                <div className="input bg-gray-50 cursor-not-allowed">{user.email}</div>
              </div>
            </div>

            {/* Contact */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="phone" className="label">Phone <span className="text-red-500">*</span></label>
                <input id="phone" name="phone" type="tel" required defaultValue={profile?.phone ?? ""} className="input" />
              </div>
              <div>
                <label htmlFor="city" className="label">City</label>
                <input id="city" name="city" type="text" defaultValue={profile?.city ?? ""} className="input" placeholder="e.g. Los Angeles" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="dob" className="label">Date of birth</label>
                <input id="dob" name="dob" type="date" defaultValue={profile?.dateOfBirth ?? ""} className="input" />
                <p className="text-xs text-gray-500 mt-1">Used to confirm you&apos;re old enough for 21+ roles.</p>
              </div>
              <div>
                <label htmlFor="uniformSize" className="label">Uniform size</label>
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

            {/* Emergency contact */}
            <div className="border-t pt-5">
              <h3 className="font-semibold text-sm mb-3">Emergency contact</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="emergencyName" className="label">Name <span className="text-red-500">*</span></label>
                  <input id="emergencyName" name="emergencyName" required defaultValue={profile?.emergencyContactName ?? ""} className="input" />
                </div>
                <div>
                  <label htmlFor="emergencyPhone" className="label">Phone <span className="text-red-500">*</span></label>
                  <input id="emergencyPhone" name="emergencyPhone" type="tel" required defaultValue={profile?.emergencyContactPhone ?? ""} className="input" />
                </div>
              </div>
            </div>

            {/* Photo */}
            <div className="border-t pt-5">
              <h3 className="font-semibold text-sm mb-1">Profile photo</h3>
              <p className="text-sm text-gray-600 mb-3">
                Shows up as your avatar across the app. Optional, but handy so teammates and your manager know who to look for on event day.
              </p>
              <ProfilePhotoField initialDataUrl={profile?.photoUrl ?? null} />
            </div>

            {savedProfile && (
              <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
                Profile saved.
              </div>
            )}
            <button type="submit" className="btn btn-primary">Save profile</button>
          </form>
        </section>

        {/* -------------------- Change password -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1">Change password</h2>
          <p className="text-sm text-gray-600 mb-5">
            At least 8 characters. Forgot it? Log out and use{" "}
            <Link href="/forgot-password" className="underline">Forgot password</Link>.
          </p>
          <form action={changePasswordAction} className="space-y-4">
            <div>
              <label htmlFor="current" className="label">Current password</label>
              <input id="current" name="current" type="password" required className="input" />
            </div>
            <div>
              <label htmlFor="next" className="label">New password</label>
              <input id="next" name="next" type="password" required minLength={8} className="input" />
            </div>
            <div>
              <label htmlFor="confirm" className="label">Confirm new password</label>
              <input id="confirm" name="confirm" type="password" required minLength={8} className="input" />
            </div>
            {savedPassword && (
              <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
                Password updated.
              </div>
            )}
            <button type="submit" className="btn btn-primary">Save new password</button>
          </form>
        </section>

        {/* -------------------- 2FA stub -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1">Two-factor authentication</h2>
          <p className="text-sm text-gray-600 mb-5">
            An extra layer of security — you&apos;d need a 6-digit code from an authenticator app in addition to your password.
          </p>
          <button type="button" disabled className="btn btn-secondary opacity-50 cursor-not-allowed">
            Enable 2FA — coming soon
          </button>
        </section>
      </main>
    </div>
  );
}
