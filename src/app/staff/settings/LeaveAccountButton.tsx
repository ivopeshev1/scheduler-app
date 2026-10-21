"use client";

import { useState } from "react";

/**
 * Two-step soft-leave button. First click opens a confirm modal; the
 * modal explains the effect (can't log back in, manager has to re-add
 * you) and takes a typed "LEAVE" to arm the submit. Server action
 * sets archivedAt + clears the session.
 */
export function LeaveAccountButton({
  action,
  companyName,
}: {
  action: (formData: FormData) => Promise<void> | void;
  companyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const canSubmit = typed.trim().toUpperCase() === "LEAVE";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn text-sm bg-red-600 text-white hover:bg-red-700"
      >
        Leave this company
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Leave {companyName}?</h2>
            <ul className="mt-3 text-sm text-gray-700 list-disc list-outside pl-5 space-y-1">
              <li>You&apos;ll be logged out and won&apos;t be able to log back in.</li>
              <li>Any shifts you&apos;ve already accepted get cancelled; your manager is notified so they can find a replacement.</li>
              <li>Your past shift history stays in {companyName}&apos;s records.</li>
              <li>If you change your mind later, your manager has to re-add you.</li>
            </ul>
            <form action={action} className="mt-5 space-y-3">
              <label htmlFor="confirm" className="label text-sm">
                Type <strong>LEAVE</strong> to confirm
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
                  Leave for good
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
