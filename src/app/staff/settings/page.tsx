import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hashPassword } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import bcrypt from "bcryptjs";
import { validateNewPassword } from "@/lib/password-reset";
import { PasswordInput } from "@/components/PasswordInput";
import { NotificationPreferencesSection } from "@/components/NotificationPreferencesSection";
import { prefsFromFormData } from "@/lib/notification-prefs";
import { revalidatePath } from "next/cache";
import { QuietHoursSection } from "@/components/QuietHoursSection";
import { ReminderTimesSection } from "@/components/ReminderTimesSection";
import { LeaveAccountButton } from "./LeaveAccountButton";
import { clearSession } from "@/lib/auth";
import { LanguageSection } from "@/components/LanguageSection";
import { StaffUiPrefsSection } from "@/components/StaffUiPrefsSection";
import { mergeStaffUiPreferences, type StaffUiPreferences } from "@/lib/staff-ui-prefs";

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

async function saveNotificationPrefsAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const next = prefsFromFormData((k) => formData.get(k), "staff");
  await db
    .update(schema.users)
    .set({ notificationPreferences: next })
    .where(eq(schema.users.id, session.userId));
  revalidatePath("/staff/settings");
  redirect("/staff/settings?saved=notifications");
}

async function leaveCompanyAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const confirm = String(formData.get("confirm") ?? "").trim().toUpperCase();
  if (confirm !== "LEAVE") redirect("/staff/settings?err=confirm-leave");

  // Cancel every accepted / pending invitation on their account + free
  // the slot so the manager sees the opening. Notifications about those
  // cancels go through the same path as a self-cancel on a shift
  // detail page, so we skip the email flood here — the archived-staff
  // email + the "you lost coverage" visibility on the event page cover it.
  const invs = await db.select().from(schema.invitations).where(eq(schema.invitations.userId, session.userId));
  for (const inv of invs) {
    if (inv.status === "pending" || inv.status === "accepted") {
      await db
        .update(schema.invitations)
        .set({ cancelledAt: new Date(), status: "rejected" })
        .where(eq(schema.invitations.id, inv.id));
      if (inv.slotId) {
        await db
          .update(schema.slots)
          .set({ acceptedUserId: null, acceptedAt: null })
          .where(eq(schema.slots.id, inv.slotId));
      }
    }
  }

  await db.update(schema.users).set({ archivedAt: new Date() }).where(eq(schema.users.id, session.userId));
  await clearSession();
  redirect("/?left=1");
}

async function saveReminderTimesAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const dbOn = formData.get("dayBeforeOn") !== null;
  const moOn = formData.get("morningOfOn") !== null;
  const dbHour = Number(formData.get("dayBeforeHour") ?? 18);
  const moHour = Number(formData.get("morningOfHour") ?? 7);
  const okDb = dbOn && Number.isInteger(dbHour) && dbHour >= 0 && dbHour <= 23 ? dbHour : null;
  const okMo = moOn && Number.isInteger(moHour) && moHour >= 0 && moHour <= 23 ? moHour : null;
  await db
    .update(schema.staffProfiles)
    .set({
      reminderDayBeforeHour: okDb,
      reminderMorningOfHour: okMo,
    })
    .where(eq(schema.staffProfiles.userId, session.userId));
  revalidatePath("/staff/settings");
  redirect("/staff/settings?saved=reminders");
}

async function saveUiPrefsAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const next: StaffUiPreferences = {
    timeFormat: (String(formData.get("timeFormat") ?? "12h") as StaffUiPreferences["timeFormat"]),
    dateFormat: (String(formData.get("dateFormat") ?? "mdy") as StaffUiPreferences["dateFormat"]),
  };
  await db
    .update(schema.staffProfiles)
    .set({ uiPreferences: next })
    .where(eq(schema.staffProfiles.userId, session.userId));
  revalidatePath("/staff/settings");
  redirect("/staff/settings?saved=display");
}

async function saveLanguageAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const lang = String(formData.get("language") ?? "en").trim();
  const ok = /^[a-z]{2}$/.test(lang) ? lang : "en";
  await db.update(schema.users).set({ language: ok }).where(eq(schema.users.id, session.userId));
  revalidatePath("/staff/settings");
  redirect("/staff/settings?saved=language");
}

async function saveQuietHoursAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");
  const enabled = formData.get("quietHoursEnabled") !== null;
  const start = String(formData.get("quietHoursStart") ?? "").trim();
  const end = String(formData.get("quietHoursEnd") ?? "").trim();
  const tz = String(formData.get("quietHoursTz") ?? "").trim() || null;
  const okStart = /^\d{1,2}:\d{2}$/.test(start) ? start : null;
  const okEnd = /^\d{1,2}:\d{2}$/.test(end) ? end : null;
  await db
    .update(schema.users)
    .set({
      quietHoursStart: enabled ? okStart : null,
      quietHoursEnd: enabled ? okEnd : null,
      quietHoursTz: enabled ? tz : null,
    })
    .where(eq(schema.users.id, session.userId));
  revalidatePath("/staff/settings");
  redirect("/staff/settings?saved=quiet");
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

        {/* -------------------- Download my data -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1">Download my data</h2>
          <p className="text-sm text-gray-600 mb-4">
            Grab a JSON file of everything we have on your account: profile, preferences, availability blocks,
            every shift you&apos;ve been invited to, and the audit log of notifications we&apos;ve sent you.
            Doesn&apos;t include your profile photo (you can save it from your profile page).
          </p>
          <a href="/staff/export" className="btn btn-secondary text-sm">Download my data (JSON)</a>
        </section>

        {/* -------------------- Leave this company -------------------- */}
        <section className="border border-red-200 rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1 text-red-700">Leave {company.name}</h2>
          <p className="text-sm text-gray-600 mb-4">
            Soft-leaves your account. You won&apos;t be able to log back in and any
            accepted shifts get cancelled. Your past history stays with {company.name} for their records.
            If you change your mind later, your manager has to re-add you.
          </p>
          <LeaveAccountButton companyName={company.name} action={leaveCompanyAction} />
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

        <NotificationPreferencesSection
          audience="staff"
          storedPrefs={user.notificationPreferences}
          formAction={saveNotificationPrefsAction}
          saved={searchParams.saved === "notifications"}
        />

        <ReminderTimesSection
          dayBefore={profile?.reminderDayBeforeHour ?? null}
          morningOf={profile?.reminderMorningOfHour ?? null}
          formAction={saveReminderTimesAction}
          saved={searchParams.saved === "reminders"}
        />

        <QuietHoursSection
          currentStart={user.quietHoursStart}
          currentEnd={user.quietHoursEnd}
          currentTz={user.quietHoursTz}
          formAction={saveQuietHoursAction}
          saved={searchParams.saved === "quiet"}
        />

        <LanguageSection
          current={user.language}
          formAction={saveLanguageAction}
          saved={searchParams.saved === "language"}
        />

        <StaffUiPrefsSection
          prefs={mergeStaffUiPreferences(profile?.uiPreferences ?? null)}
          formAction={saveUiPrefsAction}
          saved={searchParams.saved === "display"}
        />
      </main>
    </div>
  );
}
