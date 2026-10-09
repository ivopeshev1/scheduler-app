import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db/client";
import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { headers } from "next/headers";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, greeting, paragraph, banner, signoff } from "@/lib/email-html";
import { tokenExpiry } from "@/lib/password-reset";

/**
 * Self-serve password reset request. Takes an email, generates a one-time
 * token, emails a reset link. For security the UI shows the same success
 * message whether or not the email exists in our DB — this prevents the
 * form from being used as a user-enumeration oracle.
 */
async function requestResetAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/forgot-password?sent=1");

  // Load the matching active user. We intentionally don't error if there's
  // no match — the response is identical either way.
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));

  if (user && !user.archivedAt && !user.suspendedAt) {
    // Invalidate any existing unused tokens for this user before minting a
    // new one. Keeps only the latest reset link live.
    await db
      .delete(schema.passwordResetTokens)
      .where(and(
        eq(schema.passwordResetTokens.userId, user.id),
        isNull(schema.passwordResetTokens.usedAt),
      ));

    const token = nanoid(48);
    const now = new Date();
    await db.insert(schema.passwordResetTokens).values({
      token,
      userId: user.id,
      createdAt: now,
      expiresAt: tokenExpiry(now),
      usedAt: null,
    });

    const h = headers();
    const host = h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "https";
    const resetUrl = `${proto}://${host}/reset-password/${token}`;

    const [company] = await db
      .select({ name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.id, user.companyId));
    const companyName = company?.name ?? "Scheduler";

    const buttonHtml =
      `<a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Reset my password</a>`;

    await sendEmail({
      to: user.email,
      subject: `Reset your ${companyName} password`,
      body: [
        `Someone requested a password reset for your ${companyName} account.`,
        ``,
        `If this was you, open the link below within 24 hours to pick a new password:`,
        resetUrl,
        ``,
        `If it wasn't you, ignore this message — your password stays the same.`,
      ].join("\n"),
      html: shellWrap([
        greeting(null, `Someone requested a password reset for your ${companyName} account.`),
        paragraph(`Click the button below within 24 hours to pick a new password. If it wasn't you, ignore this message — nothing will change.`),
        `<p style="margin:0 0 20px;">${buttonHtml}</p>`,
        paragraph(`Reset link: <a href="${resetUrl}">${resetUrl}</a>`, { muted: true }),
        signoff(companyName),
      ].join("\n")),
      companyId: user.companyId,
      userId: user.id,
    });
  }

  redirect("/forgot-password?sent=1");
}

export default function ForgotPasswordPage({ searchParams }: { searchParams: { sent?: string } }) {
  const sent = searchParams.sent === "1";
  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <Link href="/login" className="text-sm text-gray-500 hover:underline">← Back to login</Link>
      <h1 className="text-3xl font-semibold mt-6">Forgot your password?</h1>
      {sent ? (
        <div className="mt-6 border border-green-300 bg-green-50 text-green-900 rounded p-4 text-sm">
          If an account exists for that email, we&apos;ve sent a reset link. Check your inbox — the link expires in 24 hours.
        </div>
      ) : (
        <>
          <p className="text-gray-600 mt-2 text-sm">
            Enter the email you log in with. We&apos;ll email you a one-time link to pick a new password.
          </p>
          <form action={requestResetAction} className="mt-8 space-y-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" name="email" type="email" required className="input" />
            </div>
            <button type="submit" className="btn btn-primary w-full justify-center">Send reset link</button>
          </form>
        </>
      )}
    </main>
  );
}
