"use client";

import { useState } from "react";

/**
 * Two-stage cancel-shift control. The default state is a single
 * "Cancel this shift" button. Clicking opens a confirmation modal with
 * an optional reason textarea and a destructive Confirm button that
 * posts to the server action.
 */
export function CancelShiftButton({
  inviteId,
  action,
}: {
  inviteId: string;
  action: (formData: FormData) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn text-sm bg-red-600 text-white hover:bg-red-700"
      >
        Cancel this shift
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Cancel this shift?</h2>
            <p className="text-sm text-gray-600 mt-2">
              Your manager will be notified right away so they can look for a replacement.
              Please only cancel if you really can&apos;t work it.
            </p>
            <form action={action} className="mt-4 space-y-3">
              <input type="hidden" name="inviteId" value={inviteId} />
              <div>
                <label htmlFor="reason" className="label text-sm">
                  Reason (optional)
                </label>
                <textarea
                  id="reason"
                  name="reason"
                  rows={3}
                  placeholder="e.g. family emergency, feeling sick, scheduling conflict"
                  className="input w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Shared with your manager only. Not shared with the client.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="btn btn-secondary text-sm"
                >
                  Nevermind
                </button>
                <button
                  type="submit"
                  className="btn text-sm bg-red-600 text-white hover:bg-red-700"
                >
                  Confirm cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
