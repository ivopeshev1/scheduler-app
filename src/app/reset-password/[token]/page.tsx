import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { checkResetToken, validateNewPassword } from "@/lib/password-reset";

/**
 * Password reset page — opened via the link in the forgot-password email.
 * The token in the URL is the only credential. On submit we:
 *   1. Re-verify the token (not expired, not used, exists)
 *   2. Validate the new password
 *   3. Update the user's password hash
 *   4. Mark the token used so the link stops working
 *   5. Redirect to /login so they can sign in with the new password
 */
async function doResetAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) {
    redirect(`/reset-password/${token}?err=mismatch`);
  }
  const pwErr = validateNewPassword(password);
  if (pwErr) {
    redirect(`/reset-password/${token}?err=${encodeURIComponent(pwErr)}`);
  }

  const [row] = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.token, token));
  const check = checkResetToken(row ?? null, new Date());
  if (!check.ok) {
    redirect(`/reset-password/${token}?err=${check.reason}`);
  }

  await db
    .update(schema.users)
    .set({ passwordHash: hashPassword(password) })
    .where(eq(schema.users.id, check.userId));
  await db
    .update(schema.passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.passwordResetTokens.token, token));

  redirect("/login?reset=1");
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { err?: string };
}) {
  const [row] = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.token, params.token));
  const check = checkResetToken(row ?? null, new Date());

  if (!check.ok) {
    const message =
      check.reason === "expired" ? "This reset link expired. Request a fresh one from the login page."
      : check.reason === "used" ? "This reset link was already used. Request a new one if you need to change your password again."
      : "This reset link isn't valid. Make sure you copied the whole URL from your email.";
    return (
      <main className="max-w-md mx-auto px-6 py-16">
        <h1 className="text-2xl font-semibold">Link no longer works</h1>
        <p className="text-gray-600 mt-2 text-sm">{message}</p>
        <div className="mt-6 flex gap-3">
          <Link href="/forgot-password" className="btn btn-primary">Request a new link</Link>
          <Link href="/login" className="btn btn-secondary">Back to login</Link>
        </div>
      </main>
    );
  }

  const err = searchParams.err;
  const errMessage =
    !err ? null
    : err === "mismatch" ? "The two passwords don't match."
    : err === "expired" ? "This link expired while you were on the page. Request a new one."
    : err === "used" ? "This link was already used."
    : err === "unknown" ? "This link isn't valid."
    : err;

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="text-3xl font-semibold">Pick a new password</h1>
      <p className="text-gray-600 mt-2 text-sm">Must be at least 8 characters.</p>
      <form action={doResetAction} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={params.token} />
        <div>
          <label htmlFor="password" className="label">New password</label>
          <input id="password" name="password" type="password" required minLength={8} className="input" />
        </div>
        <div>
          <label htmlFor="confirm" className="label">Confirm new password</label>
          <input id="confirm" name="confirm" type="password" required minLength={8} className="input" />
        </div>
        {errMessage && (
          <div className="border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">{errMessage}</div>
        )}
        <button type="submit" className="btn btn-primary w-full justify-center">Set new password</button>
      </form>
    </main>
  );
}
