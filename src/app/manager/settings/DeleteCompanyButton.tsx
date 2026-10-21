"use client";

import { useState } from "react";

/**
 * Owner-only "delete this company" action. Three-step guard: button
 * opens a modal, user types the company name EXACTLY to arm the
 * destructive submit. On submit, the server cascades through the
 * schema's ON DELETE CASCADE edges, wipes everything, and bounces
 * to a goodbye page.
 */
export function DeleteCompanyButton({
  action,
  companyName,
}: {
  action: (formData: FormData) => Promise<void> | void;
  companyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const canSubmit = typed.trim() === companyName.trim();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn text-sm bg-red-600 text-white hover:bg-red-700"
      >
        Delete this company
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-red-700">Delete {companyName}?</h2>
            <div className="mt-3 border border-red-300 bg-red-50 rounded p-3 text-sm text-red-900">
              <strong>This cannot be undone.</strong> It wipes:
              <ul className="mt-2 list-disc list-outside pl-5 space-y-1">
                <li>Every event, position, slot, invitation</li>
                <li>Every staff member and manager account in this company</li>
                <li>All locations, roles, add-ons, settings</li>
                <li>The notifications audit log, availability blocks, autocomplete values</li>
              </ul>
              <p className="mt-2">
                You, the owner, will be logged out and your login removed.
                Historical records won&apos;t exist anywhere anymore.
              </p>
            </div>
            <form action={action} className="mt-4 space-y-3">
              <label htmlFor="confirm" className="label text-sm">
                Type the company name <strong>{companyName}</strong> exactly to confirm
              </label>
              <input
                id="confirm"
                name="confirm"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="input"
              />
              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary text-sm">
                  Nevermind
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="btn text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete forever
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
