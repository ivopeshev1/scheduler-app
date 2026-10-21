/**
 * Quiet-hours card for staff + manager Settings pages. The user picks a
 * daily window during which SMS is paused (email ignores this).
 *
 * The form submits a flat set of fields:
 *   - quietHoursEnabled: "on" when the toggle is checked
 *   - quietHoursStart / quietHoursEnd: HH:MM 24-hour local times
 *   - quietHoursTz: IANA tz, hidden input filled by the browser from
 *     Intl.DateTimeFormat().resolvedOptions().timeZone
 */
import { QuietHoursTzField } from "./QuietHoursTzField";

export function QuietHoursSection({
  currentStart,
  currentEnd,
  currentTz,
  formAction,
  saved = false,
}: {
  currentStart: string | null;
  currentEnd: string | null;
  currentTz: string | null;
  formAction: (formData: FormData) => Promise<void> | void;
  saved?: boolean;
}) {
  const enabled = !!(currentStart && currentEnd);
  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Quiet hours (SMS)</h2>
      <p className="text-sm text-gray-600 mb-5">
        Pick a daily window where SMS pauses so your phone doesn&apos;t buzz at midnight.
        Emails still send normally — turn email off per-notification above if you want quiet nights there too.
      </p>

      <form action={formAction} className="space-y-4">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="quietHoursEnabled"
            defaultChecked={enabled}
            className="w-5 h-5"
          />
          <span>Pause SMS during quiet hours</span>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="quietHoursStart" className="label text-sm">From</label>
            <input
              id="quietHoursStart"
              name="quietHoursStart"
              type="time"
              defaultValue={currentStart ?? "21:00"}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="quietHoursEnd" className="label text-sm">To</label>
            <input
              id="quietHoursEnd"
              name="quietHoursEnd"
              type="time"
              defaultValue={currentEnd ?? "08:00"}
              className="input"
            />
          </div>
        </div>

        <QuietHoursTzField initialTz={currentTz} />

        {saved && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Quiet hours saved.
          </div>
        )}
        <button type="submit" className="btn btn-primary">Save quiet hours</button>
      </form>
    </section>
  );
}
