import {
  NOTIFICATION_CHANNELS,
  resolvePreferences,
} from "@/lib/notification-prefs";

/**
 * Shared Notifications card used on both /staff/settings and
 * /manager/settings/me. One row per notification in a single table with
 * Email + SMS columns. Required channels render with disabled+checked
 * boxes and a muted row background so the user sees why they can't be
 * turned off, without needing a separate section.
 *
 * SMS delivery itself isn't wired yet (Twilio A2P pending), so SMS
 * toggles save the preference but no texts actually go out yet. The
 * banner at the top makes that explicit.
 *
 * Parent passes a server action to formAction; it handles the DB write
 * by calling prefsFromFormData with the submitted form.
 */
export function NotificationPreferencesSection({
  audience,
  storedPrefs,
  formAction,
  saved = false,
}: {
  audience: "staff" | "manager";
  storedPrefs: unknown;
  formAction: (formData: FormData) => Promise<void> | void;
  saved?: boolean;
}) {
  const resolved = resolvePreferences(storedPrefs);
  const rows = NOTIFICATION_CHANNELS.filter((c) => c.audience === audience);

  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Notifications</h2>
      <p className="text-sm text-gray-600 mb-4">
        {audience === "staff"
          ? "Email is always on so you never miss shift info. SMS is up to you — turn it on for the things you want texts about."
          : "Pick what you want and how. A few are required (and shown with locked boxes) because missing them would break your workflow."}
      </p>
      <div className="mb-5 border border-amber-200 bg-amber-50 rounded p-3 text-xs text-amber-900">
        SMS delivery is almost ready — the carrier approval is still in flight. Your SMS
        choices save now and start sending the moment it&apos;s live. Nothing to redo.
      </div>

      <form action={formAction} className="space-y-4">
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_60px_60px] text-xs uppercase tracking-wide text-gray-500 bg-gray-50 border-b px-4 py-2">
            <span>Notification</span>
            <span className="text-center">Email</span>
            <span className="text-center">SMS</span>
          </div>
          <ul className="divide-y">
            {rows.map((c) => {
              const emailLocked = c.alwaysOn || audience === "staff";
              const smsLocked = c.alwaysOn;
              return (
                <li
                  key={c.key}
                  className={`grid grid-cols-[1fr_60px_60px] items-start gap-2 px-4 py-3 ${c.alwaysOn ? "bg-gray-50" : ""}`}
                >
                  <div className="pr-2">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {c.label}
                      {c.alwaysOn && (
                        <span className="text-[10px] uppercase tracking-wide bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">{c.description}</p>
                  </div>
                  <div className="flex justify-center items-start pt-0.5">
                    {emailLocked ? (
                      <input
                        type="checkbox"
                        checked
                        disabled
                        className="w-5 h-5 opacity-60 cursor-not-allowed"
                        aria-label={`${c.label} — email (always on)`}
                        title={c.alwaysOn ? "This notification can't be turned off." : "Email is always on so you don't miss shift info."}
                      />
                    ) : (
                      <input
                        type="checkbox"
                        id={`pref_${c.key}_email`}
                        name={`pref_${c.key}_email`}
                        defaultChecked={resolved[c.key].email}
                        className="w-5 h-5"
                        aria-label={`${c.label} — email`}
                      />
                    )}
                  </div>
                  <div className="flex justify-center items-start pt-0.5">
                    {smsLocked ? (
                      <input
                        type="checkbox"
                        checked
                        disabled
                        className="w-5 h-5 opacity-60 cursor-not-allowed"
                        aria-label={`${c.label} — SMS (always on)`}
                        title="This notification can't be turned off."
                      />
                    ) : (
                      <input
                        type="checkbox"
                        id={`pref_${c.key}_sms`}
                        name={`pref_${c.key}_sms`}
                        defaultChecked={resolved[c.key].sms}
                        className="w-5 h-5"
                        aria-label={`${c.label} — SMS`}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {saved && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Notification preferences saved.
          </div>
        )}

        <button type="submit" className="btn btn-primary">Save notification preferences</button>
      </form>
    </section>
  );
}
