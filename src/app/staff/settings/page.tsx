import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hashPassword } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import bcrypt from "bcryptjs";
import { validateNewPassword } from "@/lib/password-reset";
import { PasswordInput } from "@/components/PasswordInput";

/**
 * Staff "Settings" page — account preferences, not personal details.
 * Personal info (name, phone, emergency contact, photo) lives on
 * /staff/profile. This page covers:
 *   - Change password
 *   - 2FA (stub for now)
 *   - Notification preferences (placeholder - currently company-wide)
 */

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

  const err = searchParams.err;
  const errMessage =
    !err ? null
    : err === "mismatch" ? "The new password and confirmation don't match."
    : err === "current-wrong" ? "Current password is incorrect."
    : err === "no-password" ? "This account doesn't have a password set yet."
    : err;
  const savedPassword = searchParams.saved === "password";

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" logoUrl={company.logoUrl} />
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <div>
          <Link href="/staff" className="text-sm text-gray-500 hover:underline">← Back to my shifts</Link>
          <h1 className="text-2xl font-semibold mt-2">Settings</h1>
          <p className="text-sm text-gray-600 mt-1">
            Account preferences. Looking to change your phone, uniform, or photo?
            That&apos;s on <Link href="/staff/profile" className="underline">My profile</Link>.
          </p>
        </div>

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
              <PasswordInput id="current" name="current" required autoComplete="current-password" />
            </div>
            <div>
              <label htmlFor="next" className="label">New password</label>
              <PasswordInput id="next" name="next" required minLength={8} autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="confirm" className="label">Confirm new password</label>
              <PasswordInput id="confirm" name="confirm" required minLength={8} autoComplete="new-password" />
            </div>
            {errMessage && (
              <div className="border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">{errMessage}</div>
            )}
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

        {/* -------------------- Notifications placeholder -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1">Notifications</h2>
          <p className="text-sm text-gray-600 mb-3">
            Choose which emails and texts you get — shift invites, reminders, BEO updates,
            cancellations. Currently every staffer gets every notification; per-person
            opt-outs are coming soon.
          </p>
          <ul className="text-sm text-gray-600 space-y-1 ml-4 list-disc">
            <li>Shift invite emails</li>
            <li>Shift reminders (day before + morning of)</li>
            <li>BEO sent / updated</li>
            <li>Event cancelled</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
