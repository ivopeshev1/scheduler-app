"use client";

import { useState } from "react";

/**
 * Day-cell "Block" control for the staff calendar. One click opens a
 * small inline popover with two tabs: Whole day or Time range. The
 * server action handles the actual insert; this component only
 * collects the form fields.
 */
export function BlockDayButton({
  dateIso,
  monthSlug,
  action,
}: {
  dateIso: string;
  monthSlug: string;
  action: (formData: FormData) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "range">("all");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[10px] text-gray-500 hover:text-black hover:underline"
        title="Mark this day unavailable"
      >
        Block
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Block {prettyDate(dateIso)}</h2>
            <p className="text-sm text-gray-600 mt-1">
              Your manager won&apos;t be able to invite you for shifts that overlap this.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode("all")}
                className={`text-sm px-3 py-1.5 rounded border ${mode === "all" ? "bg-black text-white border-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                Whole day
              </button>
              <button
                type="button"
                onClick={() => setMode("range")}
                className={`text-sm px-3 py-1.5 rounded border ${mode === "range" ? "bg-black text-white border-black" : "bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                Just part of the day
              </button>
            </div>

            <form action={action} className="mt-5 space-y-3">
              <input type="hidden" name="date" value={dateIso} />
              <input type="hidden" name="month" value={monthSlug} />
              <input type="hidden" name="mode" value={mode} />
              {mode === "range" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="startTime" className="label text-xs">From</label>
                    <input id="startTime" name="startTime" type="time" defaultValue="18:00" className="input" required />
                  </div>
                  <div>
                    <label htmlFor="endTime" className="label text-xs">To</label>
                    <input id="endTime" name="endTime" type="time" defaultValue="23:00" className="input" required />
                  </div>
                </div>
              )}
              <div>
                <label htmlFor="reason" className="label text-xs">Reason (optional)</label>
                <input id="reason" name="reason" type="text" className="input" placeholder="e.g. doctor appointment, family" />
              </div>
              <div className="flex items-center justify-end gap-3 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary text-sm">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary text-sm">Block it</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function prettyDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1]} ${Number(d)}`;
}
