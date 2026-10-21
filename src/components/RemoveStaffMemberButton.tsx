"use client";

import { useState } from "react";

/**
 * Confirmation modal for removing a staff member from the Staff list.
 * The server action enforces the "can't remove if accepted shifts" guard;
 * the modal just explains it in plain English up front so the manager
 * doesn't get a stack-trace-looking page when they click Remove on
 * someone who's still booked.
 *
 * Props drive the three branches:
 *   - acceptedShifts > 0 → explain why removal is blocked, no form submit
 *   - acceptedShifts == 0 → standard confirmation + Remove button
 */
export function RemoveStaffMemberButton({
  userId,
  staffName,
  acceptedShifts,
  action,
}: {
  userId: string;
  staffName: string;
  acceptedShifts: number;
  action: (formData: FormData) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  const blocked = acceptedShifts > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-red-600 hover:underline"
        title="Remove this staff member"
      >
        Remove
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

            {blocked ? (
              <>
                <div className="mt-4 border border-amber-300 bg-amber-50 rounded p-3 text-sm text-amber-900">
                  <strong>Can&apos;t remove yet.</strong> {staffName} is confirmed on{" "}
                  <strong>{acceptedShifts} shift{acceptedShifts === 1 ? "" : "s"}</strong>.
                  Open each event and click the red × next to their name first,
                  then come back here.
                </div>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="btn btn-secondary text-sm"
                  >
                    OK, got it
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mt-2">
                  They&apos;ll be removed from the roster and can no longer log in.
                  Any pending (unresponded) invitations are silently cancelled.
                  Their shift history stays in the Log for your records.
                </p>
                <form action={action} className="mt-5 flex items-center justify-end gap-3">
                  <input type="hidden" name="userId" value={userId} />
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="btn btn-secondary text-sm"
                  >
                    Keep them
                  </button>
                  <button
                    type="submit"
                    className="btn text-sm bg-red-600 text-white hover:bg-red-700"
                  >
                    Remove
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
