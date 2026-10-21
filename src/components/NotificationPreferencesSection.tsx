import {
  NOTIFICATION_CHANNELS,
  resolvePreferences,
} from "@/lib/notification-prefs";

/**
 * Shared Notifications card used on both /staff/settings and
 * /manager/settings/me. Two checkboxes per channel (Email + SMS),
 * with alwaysOn channels shown separately as locked rows so the
 * user understands why they can't turn off (e.g.) shift invites
 * or password-reset emails.
 *
 * SMS delivery itself isn't wired yet (Twilio A2P pending), so SMS
 * toggles save the preference but no texts actually go out yet.
 * The banner at the top makes that explicit.
 *
 * Parent passes a server action to formAction; it handles the DB
 * write by calling prefsFromFormData with the submitted form.
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
  const forAudience = NOTIFICATION_CHANNELS.filter((c) => c.audience === audience);
  const toggleable = forAudience.filter((c) => !c.alwaysOn);
  const alwaysOn = forAudience.filter((c) => c.alwaysOn);

  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Notifications</h2>
      <p className="text-sm text-gray-600 mb-4">
        Pick what you want and how. Changes save when you click the button at the bottom.
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
            {toggleable.map((c) => (
              <li key={c.key} className="grid grid-cols-[1fr_60px_60px] items-start gap-2 px-4 py-3">
                <div className="pr-2">
                  <div className="font-medium text-sm">{c.label}</div>
                  <p className="text-xs text-gray-600 mt-0.5">{c.description}</p>
                </div>
                <div className="flex justify-center items-start pt-0.5">
                  <input
                    type="checkbox"
                    id={`pref_${c.key}_email`}
                    name={`pref_${c.key}_email`}
                    defaultChecked={resolved[c.key].email}
                    className="w-5 h-5"
                    aria-label={`${c.label} — email`}
                  />
                </div>
                <div className="flex justify-center items-start pt-0.5">
                  <input
                    type="checkbox"
                    id={`pref_${c.key}_sms`}
                    name={`pref_${c.key}_sms`}
                    defaultChecked={resolved[c.key].sms}
                    className="w-5 h-5"
                    aria-label={`${c.label} — SMS`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {alwaysOn.length > 0 && (
          <div className="pt-2">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
              Always on
            </div>
            <ul className="divide-y border rounded-lg bg-gray-50">
              {alwaysOn.map((c) => (
                <li key={c.key} className="px-4 py-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-sm">{c.label}</div>
                    <p className="text-xs text-gray-600 mt-0.5">{c.description}</p>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0 mt-0.5">Required</span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
