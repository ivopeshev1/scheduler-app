import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";
import { ProfilePhotoField } from "@/components/ProfilePhotoField";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, greeting, paragraph, signoff } from "@/lib/email-html";
import {
  CODE_TTL_MS,
  generateCode,
  verifyCode,
  phoneChanged,
} from "@/lib/phone-verification";

/**
 * Staff "My profile" page. Covers everything the staffer entered during
 * onboarding — phone, city, DOB, uniform, emergency contact, and photo.
 * Password + security + notifications live on /staff/settings so this
 * page stays focused on "who you are and how to reach you."
 *
 * Name + email are manager-controlled, so they render read-only.
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

  if (!phone) redirect("/staff/profile?err=phone");
  if (!emergencyName || !emergencyPhone) redirect("/staff/profile?err=emergency");

  const [existing] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));
  const phoneDidChange = phoneChanged(existing?.phone ?? null, phone);

  // When the phone changed, re-challenge: clear phoneVerifiedAt and mint
  // a fresh 6-digit code good for CODE_TTL_MS. We only email the code
  // for now (SMS not live yet). When Twilio lands, send both so the
  // staffer sees the code land on the device they actually use.
  const nextVerification: {
    phoneVerifiedAt: Date | null;
    phoneVerificationCode: string | null;
    phoneVerificationExpiresAt: Date | null;
  } = phoneDidChange
    ? {
        phoneVerifiedAt: null,
        phoneVerificationCode: generateCode(),
        phoneVerificationExpiresAt: new Date(Date.now() + CODE_TTL_MS),
      }
    : {
        phoneVerifiedAt: existing?.phoneVerifiedAt ?? null,
        phoneVerificationCode: existing?.phoneVerificationCode ?? null,
        phoneVerificationExpiresAt: existing?.phoneVerificationExpiresAt ?? null,
      };

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
      phoneVerifiedAt: nextVerification.phoneVerifiedAt,
      phoneVerificationCode: nextVerification.phoneVerificationCode,
      phoneVerificationExpiresAt: nextVerification.phoneVerificationExpiresAt,
    })
    .where(eq(schema.staffProfiles.userId, session.userId));

  if (phoneDidChange && nextVerification.phoneVerificationCode) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
    const companyName = company?.name ?? "Scheduler";
    const code = nextVerification.phoneVerificationCode;
    await sendEmail({
      to: user!.email,
      companyId: session.companyId,
      userId: session.userId,
      // Account-level security notification - skip the per-user pref check.
      notificationKey: "passwordReset",
      subject: `${companyName} phone verification code: ${code}`,
      body: `Your ${companyName} phone verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't change your phone, ignore this email.`,
      html: shellWrap([
        greeting(null, `Enter this code on your profile to confirm your new phone number.`),
        `<p style="margin:12px 0 20px;font-size:28px;font-weight:600;letter-spacing:4px;">${code}</p>`,
        paragraph(`This code expires in 10 minutes.`, { muted: true }),
        paragraph(`If you didn't change your phone, you can ignore this email — nothing has changed with your account.`, { muted: true }),
        signoff(companyName),
      ].join("\n")),
    });
  }

  revalidatePath("/staff/profile");
  redirect(phoneDidChange ? "/staff/profile?saved=1&verify=1" : "/staff/profile?saved=1");
}

async function verifyPhoneAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const code = String(formData.get("code") ?? "").trim();
  const [p] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));
  if (!p) throw new Error("Not found");
  const result = verifyCode(p.phoneVerificationCode, p.phoneVerificationExpiresAt, code);
  if (!result.ok) {
    redirect(`/staff/profile?verr=${result.reason}`);
  }
  await db
    .update(schema.staffProfiles)
    .set({
      phoneVerifiedAt: new Date(),
      phoneVerificationCode: null,
      phoneVerificationExpiresAt: null,
    })
    .where(eq(schema.staffProfiles.userId, session.userId));
  revalidatePath("/staff/profile");
  redirect("/staff/profile?verified=1");
}

async function resendPhoneCodeAction() {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const [p] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));
  if (!p || !p.phone) redirect("/staff/profile?verr=no-phone");
  const code = generateCode();
  const expires = new Date(Date.now() + CODE_TTL_MS);
  await db
    .update(schema.staffProfiles)
    .set({ phoneVerificationCode: code, phoneVerificationExpiresAt: expires })
    .where(eq(schema.staffProfiles.userId, session.userId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const companyName = company?.name ?? "Scheduler";
  await sendEmail({
    to: user!.email,
    companyId: session.companyId,
    userId: session.userId,
    notificationKey: "passwordReset",
    subject: `${companyName} phone verification code: ${code}`,
    body: `Your ${companyName} phone verification code is ${code}. It expires in 10 minutes.`,
    html: shellWrap([
      greeting(null, `Here's a fresh code to verify your phone.`),
      `<p style="margin:12px 0 20px;font-size:28px;font-weight:600;letter-spacing:4px;">${code}</p>`,
      paragraph(`This code expires in 10 minutes.`, { muted: true }),
      signoff(companyName),
    ].join("\n")),
  });
  revalidatePath("/staff/profile");
  redirect("/staff/profile?saved=1&verify=1&resent=1");
}

export default async function StaffProfilePage({
  searchParams,
}: {
  searchParams: { err?: string; saved?: string; verify?: string; verr?: string; verified?: string; resent?: string };
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
    : err;
  const saved = searchParams.saved === "1";
  const needsVerify = !!(profile?.phone && !profile?.phoneVerifiedAt);
  const hasActiveCode = !!(profile?.phoneVerificationCode && profile?.phoneVerificationExpiresAt && profile.phoneVerificationExpiresAt.getTime() > Date.now());
  const verifyBanner = searchParams.verify === "1";
  const verified = searchParams.verified === "1";
  const resent = searchParams.resent === "1";
  const verr = searchParams.verr;
  const verrMessage =
    verr === "mismatch" ? "That code doesn't match. Double-check and try again."
    : verr === "expired" ? "That code expired. Click Resend code to get a fresh one."
    : verr === "no-code" ? "No active code. Click Resend code to get one."
    : verr === "no-phone" ? "Add a phone number first, then verify it."
    : null;

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" logoUrl={company.logoUrl} />
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link href="/staff" className="text-sm text-gray-500 hover:underline">← Back to my shifts</Link>
          <h1 className="text-2xl font-semibold mt-2">My profile</h1>
          <p className="text-sm text-gray-600 mt-1">
            Personal details for <strong>{profile?.firstName} {profile?.lastName}</strong>.
            Need your name or email changed? Message your manager at {company.name}.
          </p>
        </div>

        {errMessage && (
          <div className="border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">{errMessage}</div>
        )}
        {saved && !verifyBanner && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Profile saved.
          </div>
        )}
        {verified && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Phone verified. SMS reminders will go to this number as soon as SMS is live.
          </div>
        )}

        {needsVerify && (
          <section className="border-2 border-amber-400 bg-amber-50 rounded-lg p-5">
            <h2 className="font-semibold text-base">Verify your phone</h2>
            {hasActiveCode ? (
              <>
                <p className="text-sm text-amber-900 mt-1">
                  {resent ? "Fresh code just sent. " : saved ? "We just emailed a 6-digit code to " : "We've emailed a 6-digit code to "}
                  <strong>{user.email}</strong>. Enter it below to confirm your phone number. The code expires in 10 minutes.
                </p>
                {verrMessage && (
                  <div className="mt-3 border border-red-300 bg-red-50 text-red-800 text-sm rounded p-2">
                    {verrMessage}
                  </div>
                )}
                <div className="mt-4 flex items-end gap-3">
                  <form action={verifyPhoneAction} className="flex items-end gap-3">
                    <div>
                      <label htmlFor="code" className="label text-xs">Verification code</label>
                      <input
                        id="code"
                        name="code"
                        type="text"
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        autoComplete="one-time-code"
                        required
                        className="input w-40 tracking-widest text-center"
                        placeholder="000000"
                      />
                    </div>
                    <button type="submit" className="btn btn-primary">Verify</button>
                  </form>
                  <form action={resendPhoneCodeAction}>
                    <button type="submit" className="btn btn-secondary text-sm">Resend code</button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-amber-900 mt-1">
                  Your phone <strong>{profile?.phone}</strong> isn&apos;t verified yet.
                  Verify it so SMS reminders can start when SMS goes live.
                </p>
                {verrMessage && (
                  <div className="mt-3 border border-red-300 bg-red-50 text-red-800 text-sm rounded p-2">
                    {verrMessage}
                  </div>
                )}
                <form action={resendPhoneCodeAction} className="mt-4">
                  <button type="submit" className="btn btn-primary text-sm">Send me a code</button>
                </form>
              </>
            )}
          </section>
        )}

        <section className="border rounded-lg bg-white p-6">
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
                <label htmlFor="phone" className="label flex items-center gap-2">
                  Phone <span className="text-red-500">*</span>
                  {profile?.phone && profile.phoneVerifiedAt && (
                    <span className="text-[10px] uppercase tracking-wide bg-green-100 text-green-800 px-1.5 py-0.5 rounded">
                      Verified
                    </span>
                  )}
                  {profile?.phone && !profile.phoneVerifiedAt && (
                    <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                      Unverified
                    </span>
                  )}
                </label>
                <input id="phone" name="phone" type="tel" required defaultValue={profile?.phone ?? ""} className="input" />
                <p className="text-xs text-gray-500 mt-1">
                  Changing it requires a quick 6-digit code to confirm the new number before SMS reminders start.
                </p>
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

            <button type="submit" className="btn btn-primary">Save profile</button>
          </form>
        </section>
      </main>
    </div>
  );
}
