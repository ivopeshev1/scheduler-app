"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Single-cell "Customize times" control for a position row. Default is "Event times"
 * (the row uses the event's check-in / end times). Clicking opens a small
 * popover with Start / End boxes for a custom time on this row. Clearing
 * both goes back to "Event times".
 *
 * Writes two hidden inputs so the classic <form action=...> server action
 * can read them. Empty strings mean "use event times".
 */
export function PositionTimeControl({
  startFieldName,
  endFieldName,
  defaultStart,
  defaultEnd,
  invitedCount = 0,
}: {
  startFieldName: string;
  endFieldName: string;
  defaultStart?: string | null;
  defaultEnd?: string | null;
  // Staff already invited to this row. When > 0 and the times change, the
  // popover warns that they will be emailed on save.
  invitedCount?: number;
}) {
  const [start, setStart] = useState<string>(defaultStart ?? "");
  const [end, setEnd] = useState<string>(defaultEnd ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const custom = !!(start || end);
  const changed = start !== (defaultStart ?? "") || end !== (defaultEnd ?? "");
  const warn = changed && invitedCount > 0;
  const label = custom
    ? `${start ? fmt(start) : "Event check-in"} – ${end ? fmt(end) : "Event end"}`
    : "Current event times";

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={startFieldName} value={start} />
      <input type="hidden" name={endFieldName} value={end} />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`input text-left flex items-center justify-between w-full ${custom ? "" : "text-gray-500"} ${warn ? "border-amber-400" : ""}`}
      >
        <span className="truncate">{label}</span>
        <span className="text-gray-400 ml-1">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-[320px] bg-white border border-gray-300 rounded-md shadow-lg p-1">
          <button
            type="button"
            onClick={() => {
              setStart("");
              setEnd("");
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 flex items-center gap-2 ${
              !custom ? "bg-gray-50 font-medium" : ""
            }`}
          >
            <span className="w-3 inline-block">{!custom ? "•" : ""}</span>
            Current event times
          </button>

          <div className={`px-3 py-2 text-sm rounded ${custom ? "bg-gray-50 font-medium" : ""}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 inline-block">{custom ? "•" : ""}</span>
              <span>Custom times for this row</span>
            </div>
            <div className="flex items-center gap-2 pl-5">
              <label className="flex-1 min-w-0">
                <span className="block text-xs text-gray-500 font-normal">Check in</span>
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="w-full min-w-0 border border-gray-300 rounded px-1.5 py-1 text-sm outline-none focus:border-gray-500"
                />
              </label>
              <label className="flex-1 min-w-0">
                <span className="block text-xs text-gray-500 font-normal">End</span>
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setOpen(false);
                    }
                  }}
                  className="w-full min-w-0 border border-gray-300 rounded px-1.5 py-1 text-sm outline-none focus:border-gray-500"
                />
              </label>
            </div>
            {warn && (
              <p className="pl-5 mt-2 text-xs text-amber-800 font-normal">
                {invitedCount} invited staff will get a &quot;shift updated&quot; email when you save.
              </p>
            )}
            <div className="flex justify-end pl-5 mt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "16:30" -> "4:30 PM" */
function fmt(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  if (!Number.isFinite(h)) return t;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr ?? "00"} ${suffix}`;
}
