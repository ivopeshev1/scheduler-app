"use client";

import { useState } from "react";

type RosterEntry = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string;
  roles: string[];
  isOnCall: boolean;
};

/**
 * Collapsible "Who else is working" section for the staff shift detail.
 * Shows the count in the header; expand to see names, roles, and phone
 * numbers. Confirmed-only (pending invites are deliberately hidden —
 * that's manager business and avoids anxiety when someone later declines).
 */
export function ShiftRosterSection({ roster }: { roster: RosterEntry[] }) {
  const [open, setOpen] = useState(false);
  const n = roster.length;
  return (
    <section className="border rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50"
      >
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Who else is working</div>
          <div className="text-sm text-gray-700 mt-0.5">
            {n === 0 ? "Just you so far." : `${n} teammate${n === 1 ? "" : "s"} confirmed`}
          </div>
        </div>
        <span className="text-sm text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && n > 0 && (
        <ul className="border-t divide-y">
          {roster.map((p) => (
            <li key={p.userId} className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-sm">
                  {p.firstName || p.lastName ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : p.email}
                  {p.isOnCall && <span className="ml-2 text-xs text-gray-500">(on-call)</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {p.roles.join(", ") || "—"}
                </div>
              </div>
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="text-sm text-blue-700 underline shrink-0">
                  {p.phone}
                </a>
              ) : (
                <span className="text-xs text-gray-400 shrink-0">no phone on file</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && n === 0 && (
        <div className="border-t p-4 text-sm text-gray-500 text-center">
          You&apos;re the only one confirmed so far.
        </div>
      )}
    </section>
  );
}
