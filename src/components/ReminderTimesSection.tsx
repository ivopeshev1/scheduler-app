/**
 * Shift-reminder opt-in card for /staff/settings. Single toggle for the
 * day-before reminder; the cron sends one email per shift tomorrow at
 * a company-wide morning hour.
 *
 * Simplified from an earlier per-staffer hour-picker design because
 * Vercel's Hobby plan caps crons at daily. The staff_profiles columns
 * reminderDayBeforeHour + reminderMorningOfHour stay in the DB so a
 * future Pro-plan upgrade can restore per-staffer timing without
 * another migration; for now we reuse reminderDayBeforeHour as a
 * sentinel - non-null means "on", null means "off" - and ignore the
 * hour value.
 */

export function ReminderTimesSection({
  dayBefore,
  formAction,
  saved = false,
}: {
  dayBefore: number | null;
  formAction: (formData: FormData) => Promise<void> | void;
  saved?: boolean;
}) {
  const dbEnabled = dayBefore !== null;

  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Shift reminders</h2>
      <p className="text-sm text-gray-600 mb-5">
        One email the day before each shift you&apos;ve accepted, sent in the morning so
        you have time to plan. Toggle it off if you don&apos;t want it.
      </p>

      <form action={formAction} className="space-y-4">
        <div className="border rounded-lg p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="dayBeforeOn"
              defaultChecked={dbEnabled}
              className="w-5 h-5 mt-0.5"
            />
            <span>
              <span className="text-sm font-medium block">Email me the day before each shift</span>
              <span className="text-xs text-gray-500 block mt-0.5">
                Fires once each morning for every shift you&apos;re on tomorrow.
              </span>
            </span>
          </label>
        </div>

        {saved && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Reminder preference saved.
          </div>
        )}
        <button type="submit" className="btn btn-primary">Save</button>
      </form>
    </section>
  );
}
