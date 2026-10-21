"use client";

import { useState } from "react";

/**
 * Shown next to each view-only company-settings section for non-owner
 * managers. One click opens a modal with a textarea; submitting emails
 * the owners of this company with the manager's name, the section
 * header, and the free-text message.
 */
export function RequestChangesButton({
  section,
  action,
}: {
  section: string;
  action: (formData: FormData) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-600 hover:text-black underline"
        title="Email the owner asking them to change this"
      >
        Request changes
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Request changes</h2>
            <p className="text-sm text-gray-600 mt-1">
              This emails the owner. They&apos;ll see what you&apos;re asking about and your name — reply directly if you want to discuss.
            </p>
            <form action={action} className="mt-4 space-y-3">
              <input type="hidden" name="section" value={section} />
              <div>
                <label className="label text-xs">Section</label>
                <div className="input bg-gray-50 cursor-not-allowed text-sm">{section}</div>
              </div>
              <div>
                <label htmlFor="message" className="label text-xs">What&apos;d you like changed?</label>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  required
                  minLength={3}
                  placeholder={`e.g. "Bump the urgent threshold to 24h — we had two shifts fall through last week."`}
                  className="input w-full"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary text-sm">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary text-sm">
                  Send to owner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
