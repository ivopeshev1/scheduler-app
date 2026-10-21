/**
 * Language preference card. The actual translations are a dedicated
 * follow-up pass; saving the preference now so the UX doesn't change
 * once they land - you'll just see the app flip language.
 */

const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español (coming soon)" },
  { code: "pt", label: "Português (coming soon)" },
  { code: "fr", label: "Français (coming soon)" },
];

export function LanguageSection({
  current,
  formAction,
  saved = false,
}: {
  current: string | null;
  formAction: (formData: FormData) => Promise<void> | void;
  saved?: boolean;
}) {
  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Language</h2>
      <p className="text-sm text-gray-600 mb-5">
        Pick the language you want the app and emails in. English is live now;
        other languages save your preference and switch on automatically when they roll out.
      </p>
      <form action={formAction} className="space-y-4">
        <select
          name="language"
          defaultValue={current ?? "en"}
          className="input max-w-xs"
          aria-label="Preferred language"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        {saved && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Language preference saved.
          </div>
        )}
        <div>
          <button type="submit" className="btn btn-primary">Save language</button>
        </div>
      </form>
    </section>
  );
}
