"use client";

import { useState } from "react";

/**
 * Red-X Remove control for one roster row on the event detail page.
 * Click → modal with two options:
 *   1. Remove and notify the staffer. An optional reason textarea goes
 *      into the "Shift removed" email so the manager can give context
 *      ("double-booked, sorry", "scope changed", etc.).
 *   2. Remove silently. No email. Record still soft-deleted so history
 *      and availability behave the same way.
 *
 * The actual DB write + email dispatch happen in the server action; this
 * component just submits a form with the right flags.
 */
export function RemoveStaffButton({
  invitationId,
  staffName,
  action,
}: {
  invitationId: string;
  staffName: string;
  // Server action: formData.get("invitationId"), formData.get("notify") ("1"|"0"),
  // formData.get("reason") (string, optional)
  action: (formData: FormData) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [notify, setNotify] = useState(true);
  const [reason, setReason] = useState("");

  return (
    <>
      <button
        type="button"
        aria-label={`Remove ${staffName}`}
        title={`Remove ${staffName}`}
        onClick={() => setOpen(true)}
        className="text-red-500 hover:text-red-700 text-base leading-none font-bold px-2 cursor-pointer"
      >
        ×
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Remove {staffName}?</h2>
            <p className="text-sm text-gray-600 mt-1">
              They&apos;ll be released from this shift and freed up to be invited to other events the same day.
            </p>

            <div className="mt-5 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="notify-choice"
                  checked={notify}
                  onChange={() => setNotify(true)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-sm">Notify them by email</div>
                  <div className="text-xs text-gray-500">Standard &quot;Shift removed&quot; email. You can add a message below.</div>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="notify-choice"
                  checked={!notify}
                  onChange={() => setNotify(false)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-sm">Remove silently</div>
                  <div className="text-xs text-gray-500">No email. Use when they already know (texted you, etc.).</div>
                </div>
              </label>
            </div>

            {notify && (
              <div className="mt-4">
                <label htmlFor="remove-reason" className="label text-sm">
                  Message to staff (optional)
                </label>
                <textarea
                  id="remove-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. Scope changed and we need a different role. Thanks for understanding."
                  className="input text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">Shown in the email body so they know why.</p>
              </div>
            )}

            <form action={action} className="mt-6 flex items-center justify-end gap-3">
              <input type="hidden" name="invitationId" value={invitationId} />
              <input type="hidden" name="notify" value={notify ? "1" : "0"} />
              <input type="hidden" name="reason" value={reason} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-secondary text-sm"
              >
                Keep them on
              </button>
              <button type="submit" className="btn text-sm bg-red-600 text-white hover:bg-red-700">
                {notify ? "Remove and notify" : "Remove silently"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
