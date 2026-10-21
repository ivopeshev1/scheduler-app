import {
  NOTIFICATION_CHANNELS,
  resolvePreferences,
} from "@/lib/notification-prefs";

/**
 * Shared Notifications card used on both /staff/settings and
 * /manager/settings/me. Renders a toggle per optional notification
 * for the given audience, with alwaysOn channels shown separately
 * as locked rows so the user understands why they can't turn off
 * (e.g.) password-reset emails.
 *
 * The form is bound by the parent — pass a server action to
 * formAction, and the parent handles the DB write by calling
 * prefsFromFormData with the submitted form.
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
      <p className="text-sm text-gray-600 mb-5">
        Choose which emails you want. Changes save when you click the button at the bottom.
      </p>

      <form action={formAction} className="space-y-4">
        <ul className="divide-y border rounded-lg">
          {toggleable.map((c) => (
            <li key={c.key} className="p-4 flex items-start justify-between gap-4">
              <div>
                <label htmlFor={`pref_${c.key}`} className="font-medium text-sm block">
                  {c.label}
                </label>
                <p className="text-xs text-gray-600 mt-0.5">{c.description}</p>
              </div>
              <input
                type="checkbox"
                id={`pref_${c.key}`}
                name={`pref_${c.key}`}
                defaultChecked={resolved[c.key]}
                className="w-5 h-5 shrink-0 mt-0.5"
              />
            </li>
          ))}
        </ul>

        {alwaysOn.length > 0 && (
          <div className="pt-2">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
              Always on
            </div>
            <ul className="divide-y border rounded-lg bg-gray-50">
              {alwaysOn.map((c) => (
                <li key={c.key} className="p-4 flex items-start justify-between gap-4">
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
