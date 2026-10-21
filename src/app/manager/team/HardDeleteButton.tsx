"use client";

import { useState } from "react";

/**
 * Hard-delete-manager confirm modal. Shown on the Admin page for any
 * manager row the owner wants to permanently wipe (handy for cleaning
 * up a stuck test row - the normal Remove soft-archives). Type DELETE
 * to arm the submit.
 */
export function HardDeleteButton({
  action,
  userId,
  label,
}: {
  action: (formData: FormData) => Promise<void> | void;
  userId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const armed = typed.trim().toUpperCase() === "DELETE";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-red-700 hover:underline"
        title="Permanently remove this account from the database"
      >
        Delete permanently
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Permanently delete {label}?</h2>
            <div className="mt-3 border border-red-300 bg-red-50 rounded p-3 text-sm text-red-900">
              Nukes the DB row and everything tied to it (profile, locations, invitation history, availability blocks).
              Non-cascading links on events / slots / notifications are nulled so history stays legible without the name.
              <p className="mt-2">
                This is harder than the normal <strong>Remove</strong>. Use it to clean up a stuck row that you want to re-invite with the same email from a clean slate.
              </p>
            </div>
            <form action={action} className="mt-4 space-y-3">
              <input type="hidden" name="userId" value={userId} />
              <label htmlFor="confirm" className="label text-sm">
                Type <strong>DELETE</strong> to confirm
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
                  disabled={!armed}
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
