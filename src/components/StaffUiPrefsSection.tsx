/**
 * Staff display-format preferences. Mirrors the manager's time/date
 * format controls but drops the landing-tab + calendar-view defaults
 * (not applicable to the simpler staff UI).
 */
import type { StaffUiPreferences } from "@/lib/staff-ui-prefs";

export function StaffUiPrefsSection({
  prefs,
  formAction,
  saved = false,
}: {
  prefs: StaffUiPreferences;
  formAction: (formData: FormData) => Promise<void> | void;
  saved?: boolean;
}) {
  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Display preferences</h2>
      <p className="text-sm text-gray-600 mb-5">
        How dates and times are formatted everywhere you see them. Doesn&apos;t change what&apos;s stored.
      </p>
      <form action={formAction} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="timeFormat" className="label">Time format</label>
            <select id="timeFormat" name="timeFormat" defaultValue={prefs.timeFormat} className="input">
              <option value="12h">12-hour (4:30 PM)</option>
              <option value="24h">24-hour (16:30)</option>
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
        {saved && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Display preferences saved.
          </div>
        )}
        <button type="submit" className="btn btn-primary">Save display preferences</button>
      </form>
      <p className="text-xs text-gray-500 mt-4">
        Note: the display helpers haven&apos;t finished reading your preference everywhere yet — the choice is saved and gets picked up as those finish rolling out.
      </p>
    </section>
  );
}
