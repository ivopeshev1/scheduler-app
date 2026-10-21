/**
 * Shift-reminder lead-time card for /staff/settings. Two toggles: a
 * day-before reminder (hour picker, defaults 6pm) and a morning-of
 * reminder (hour picker, defaults 7am). Either can be turned off
 * independently; both off means no reminders.
 *
 * Hour is 0–23 in the staffer's local timezone (set on /staff/profile).
 * The actual reminder fire logic will read these when the reminder
 * cron ships; the card here persists the preference.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function labelFor(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export function ReminderTimesSection({
  dayBefore,
  morningOf,
  formAction,
  saved = false,
}: {
  dayBefore: number | null;
  morningOf: number | null;
  formAction: (formData: FormData) => Promise<void> | void;
  saved?: boolean;
}) {
  const dbEnabled = dayBefore !== null;
  const moEnabled = morningOf !== null;
  const dbHour = dayBefore ?? 18;
  const moHour = morningOf ?? 7;

  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Shift reminders — when</h2>
      <p className="text-sm text-gray-600 mb-5">
        Pick when your shift reminders fire. Pick what channels they fire on
        in the Notifications table above. Times are in your local timezone (set on your profile).
      </p>

      <form action={formAction} className="space-y-4">
        <div className="border rounded-lg p-4 space-y-2">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="dayBeforeOn"
              defaultChecked={dbEnabled}
              className="w-5 h-5"
            />
            <span className="text-sm font-medium">Day-before reminder</span>
          </label>
          <div className="flex items-center gap-2 pl-8 text-sm">
            <span className="text-gray-600">at</span>
            <select name="dayBeforeHour" defaultValue={String(dbHour)} className="input w-28">
              {HOURS.map((h) => (
                <option key={h} value={h}>{labelFor(h)}</option>
              ))}
            </select>
            <span className="text-gray-500 text-xs">the night before each shift</span>
          </div>
        </div>

        <div className="border rounded-lg p-4 space-y-2">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="morningOfOn"
              defaultChecked={moEnabled}
              className="w-5 h-5"
            />
            <span className="text-sm font-medium">Morning-of reminder</span>
          </label>
          <div className="flex items-center gap-2 pl-8 text-sm">
            <span className="text-gray-600">at</span>
            <select name="morningOfHour" defaultValue={String(moHour)} className="input w-28">
              {HOURS.map((h) => (
                <option key={h} value={h}>{labelFor(h)}</option>
              ))}
            </select>
            <span className="text-gray-500 text-xs">on the day of each shift</span>
          </div>
        </div>

        {saved && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Reminder times saved.
          </div>
        )}
        <button type="submit" className="btn btn-primary">Save reminder times</button>
      </form>
    </section>
  );
}
