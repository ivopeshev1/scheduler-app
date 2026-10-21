import {
  NOTIFICATION_CHANNELS,
  resolvePreferences,
} from "@/lib/notification-prefs";

/**
 * Notifications card. Columns:
 *   - Notification (label + description)
 *   - Email (always on, disabled checkbox — the audit-trail floor)
 *   - SMS   (user-choice checkbox, defaults off)
 *   - Delivery (manager only; Individual / Summary / Both dropdown for
 *     digestable channels; "Immediate" static label for time-sensitive)
 *
 * Staff see three columns; managers see four. The SMS column is wired
 * to pref_<key>_sms; the Delivery dropdown is wired to pref_<key>_mode.
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
  const showMode = audience === "manager";

  const gridCols = showMode ? "grid-cols-[1fr_60px_60px_130px]" : "grid-cols-[1fr_60px_60px]";

  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Notifications</h2>
      <p className="text-sm text-gray-600 mb-4">
        Email is always on so you have an audit trail you can go back to. SMS is up to you —
        turn it on for the things you actually want texts about.
        {showMode && (
          <> Delivery lets you say when email fires: <strong>Individual</strong> sends immediately,
          {" "}<strong>Summary</strong> rolls into the daily digest, <strong>Both</strong> does both.</>
        )}
      </p>
      <div className="mb-5 border border-amber-200 bg-amber-50 rounded p-3 text-xs text-amber-900">
        SMS delivery is almost ready — the carrier approval is still in flight. Your SMS
        choices save now and start sending the moment it&apos;s live. Nothing to redo.
      </div>

      <form action={formAction} className="space-y-4">
        <div className="border rounded-lg overflow-hidden">
          <div className={`grid ${gridCols} text-xs uppercase tracking-wide text-gray-500 bg-gray-50 border-b px-4 py-2`}>
            <span>Notification</span>
            <span className="text-center">Email</span>
            <span className="text-center">SMS</span>
            {showMode && <span className="text-center">Delivery</span>}
          </div>
          <ul className="divide-y">
            {rows.map((c) => (
              <li key={c.key} className={`grid ${gridCols} items-start gap-2 px-4 py-3`}>
                <div className="pr-2">
                  <div className="font-medium text-sm">{c.label}</div>
                  <p className="text-xs text-gray-600 mt-0.5">{c.description}</p>
                </div>
                <div className="flex justify-center items-start pt-0.5">
                  <input
                    type="checkbox"
                    checked
                    disabled
                    className="w-5 h-5 opacity-60 cursor-not-allowed"
                    aria-label={`${c.label} — email (always on)`}
                    title="Email is always on so you have an audit trail you can go back to."
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
                {showMode && (
                  <div className="flex justify-center items-start">
                    {c.digestable ? (
                      <select
                        name={`pref_${c.key}_mode`}
                        defaultValue={resolved[c.key].emailMode ?? "individual"}
                        className="input text-xs py-1 w-full"
                        aria-label={`${c.label} — delivery`}
                      >
                        <option value="individual">Individual</option>
                        <option value="summary">Summary</option>
                        <option value="both">Both</option>
                      </select>
                    ) : (
                      <span
                        className="text-xs text-gray-500 italic pt-1 text-center"
                        title="Time-sensitive — always sent immediately."
                      >
                        Immediate
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
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
