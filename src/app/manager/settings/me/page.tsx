import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, hashPassword } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { validateNewPassword } from "@/lib/password-reset";
import { mergeUiPreferences, type UiPreferences } from "@/lib/ui-prefs";
import { PasswordInput } from "@/components/PasswordInput";
import { NotificationPreferencesSection } from "@/components/NotificationPreferencesSection";
import { prefsFromFormData } from "@/lib/notification-prefs";
import { QuietHoursSection } from "@/components/QuietHoursSection";
import { LanguageSection } from "@/components/LanguageSection";

/**
 * Personal settings for the signed-in manager (owner or regular). Any
 * manager can see this page — there's nothing company-wide here.
 *
 *   - Change password (requires current password)
 *   - UI preferences (default landing tab, calendar view, time/date
 *     format) — stored as a JSON blob on manager_profiles.ui_preferences
 *   - 2FA stub (coming soon)
 *
 * Notification preferences will migrate here from Company settings in a
 * follow-up pass. For now they stay company-wide.
 */

async function changePasswordAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next !== confirm) redirect("/manager/settings/me?err=mismatch");
  const pwErr = validateNewPassword(next);
  if (pwErr) redirect(`/manager/settings/me?err=${encodeURIComponent(pwErr)}`);

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user?.passwordHash) redirect("/manager/settings/me?err=no-password");
  if (!bcrypt.compareSync(current, user.passwordHash!)) {
    redirect("/manager/settings/me?err=current-wrong");
  }

  await db
    .update(schema.users)
    .set({ passwordHash: hashPassword(next) })
    .where(eq(schema.users.id, session.userId));
  redirect("/manager/settings/me?saved=password");
}

async function saveNotificationPrefsAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const next = prefsFromFormData((k) => formData.get(k), "manager");
  await db
    .update(schema.users)
    .set({ notificationPreferences: next })
    .where(eq(schema.users.id, session.userId));
  revalidatePath("/manager/settings/me");
  redirect("/manager/settings/me?saved=notifications");
}

async function saveLanguageAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const lang = String(formData.get("language") ?? "en").trim();
  const ok = /^[a-z]{2}$/.test(lang) ? lang : "en";
  await db.update(schema.users).set({ language: ok }).where(eq(schema.users.id, session.userId));
  revalidatePath("/manager/settings/me");
  redirect("/manager/settings/me?saved=language");
}

async function saveQuietHoursAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
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
  revalidatePath("/manager/settings/me");
  redirect("/manager/settings/me?saved=quiet");
}

async function saveUiPrefsAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const next: UiPreferences = {
    defaultLandingTab: (String(formData.get("defaultLandingTab") ?? "calendar-grid") as UiPreferences["defaultLandingTab"]),
    calendarDefaultView: (String(formData.get("calendarDefaultView") ?? "grid") as UiPreferences["calendarDefaultView"]),
    timeFormat: (String(formData.get("timeFormat") ?? "12h") as UiPreferences["timeFormat"]),
    dateFormat: (String(formData.get("dateFormat") ?? "mdy") as UiPreferences["dateFormat"]),
  };

  const [existing] = await db
    .select()
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, session.userId));
  if (existing) {
    await db
      .update(schema.managerProfiles)
      .set({ uiPreferences: next })
      .where(eq(schema.managerProfiles.userId, session.userId));
  }
  revalidatePath("/manager/settings/me");
  redirect("/manager/settings/me?saved=prefs");
}

export default async function MySettingsPage({ searchParams }: { searchParams: { err?: string; saved?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  const [profile] = await db
    .select()
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, session.userId));
  if (!user) redirect("/login");

  const prefs = mergeUiPreferences(profile?.uiPreferences ?? null);

  const pwErr = searchParams.err;
  const pwErrMessage =
    !pwErr ? null
    : pwErr === "mismatch" ? "The new password and confirmation don't match."
    : pwErr === "current-wrong" ? "Current password is incorrect."
    : pwErr === "no-password" ? "This account doesn't have a password set."
    : pwErr;
  const savedPassword = searchParams.saved === "password";
  const savedPrefs = searchParams.saved === "prefs";

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} canAccessPayroll={!!user.canAccessPayroll} />
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <div>
          <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
          <h1 className="text-2xl font-semibold mt-2">My settings</h1>
          <p className="text-sm text-gray-600 mt-1">
            Personal account settings. Everything on this page applies to <strong>your login only</strong> — other managers in {company.name} have their own.
          </p>
        </div>

        {/* -------------------- Change password -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1">Change password</h2>
          <p className="text-sm text-gray-600 mb-5">At least 8 characters. We never show you the old one — if you forgot it, log out and use <Link href="/forgot-password" className="underline">Forgot password</Link>.</p>
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
            {pwErrMessage && (
              <div className="border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">{pwErrMessage}</div>
            )}
            {savedPassword && (
              <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">Password updated.</div>
            )}
            <button type="submit" className="btn btn-primary">Save new password</button>
          </form>
        </section>

        {/* -------------------- UI preferences -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1">UI preferences</h2>
          <p className="text-sm text-gray-600 mb-5">How the app looks and where it lands when you log in.</p>
          <form action={saveUiPrefsAction} className="space-y-5">
            <div>
              <label htmlFor="defaultLandingTab" className="label">Default landing tab</label>
              <select id="defaultLandingTab" name="defaultLandingTab" defaultValue={prefs.defaultLandingTab} className="input">
                <option value="calendar-grid">Calendar — Grid view (default)</option>
                <option value="calendar-list">Calendar — List view</option>
                <option value="payroll">Payroll</option>
                <option value="staff">Staff</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Where you land right after you log in.</p>
            </div>
            <div>
              <label htmlFor="calendarDefaultView" className="label">Calendar default view</label>
              <select id="calendarDefaultView" name="calendarDefaultView" defaultValue={prefs.calendarDefaultView} className="input">
                <option value="grid">Grid (month-at-a-glance)</option>
                <option value="list">List (one event per row)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">The default when you click Calendar from the nav.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="timeFormat" className="label">Time format</label>
                <select id="timeFormat" name="timeFormat" defaultValue={prefs.timeFormat} className="input">
                  <option value="12h">12-hour (e.g. 4:30 PM)</option>
                  <option value="24h">24-hour (e.g. 16:30)</option>
                </select>
              </div>
              <div>
                <label htmlFor="dateFormat" className="label">Date format</label>
                <select id="dateFormat" name="dateFormat" defaultValue={prefs.dateFormat} className="input">
                  <option value="mdy">10/13/2026 (US)</option>
                  <option value="dmy">13/10/2026 (EU)</option>
                  <option value="iso">2026-10-13 (ISO)</option>
                </select>
              </div>
            </div>
            {savedPrefs && (
              <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">UI preferences saved.</div>
            )}
            <button type="submit" className="btn btn-primary">Save preferences</button>
          </form>
          <p className="text-xs text-gray-500 mt-4">
            Note: time + date format are stored but not yet applied app-wide — they&apos;ll take effect once the display helpers are migrated to read your preference.
          </p>
        </section>

        {/* -------------------- 2FA stub -------------------- */}
        <section className="border rounded-lg bg-white p-6">
          <h2 className="font-semibold text-lg mb-1">Two-factor authentication</h2>
          <p className="text-sm text-gray-600 mb-5">An extra layer of security — you&apos;d need a 6-digit code from an authenticator app in addition to your password.</p>
          <button type="button" disabled className="btn btn-secondary opacity-50 cursor-not-allowed">
            Enable 2FA — coming soon
          </button>
        </section>

        <NotificationPreferencesSection
          audience="manager"
          storedPrefs={user.notificationPreferences}
          formAction={saveNotificationPrefsAction}
          saved={searchParams.saved === "notifications"}
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
      </main>
    </div>
  );
}
