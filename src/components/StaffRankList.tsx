"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

export type StaffRankRow = {
  userId: string;
  firstName: string;
  lastName: string;
  city: string | null;
  acceptPct: number | null;
  responsePct: number | null;
  avgResponseHours: number | null;
  cancelled: number;
  noShows: number;
  lateCount: number;
  activationPct: number | null;
  totalHours: number;
  paidShiftCount: number;
};

/**
 * Drag-and-drop staff ranking list. Mirrors components/RolesList.tsx exactly
 * — same native HTML5 DnD pattern, same optimistic-local-update then persist.
 * The persisted order flows through staffProfiles.rankOrder and drives the
 * StaffPicker display order when a manager invites staff to a shift.
 */
export function StaffRankList({
  initialRows,
  onReorder,
}: {
  initialRows: StaffRankRow[];
  onReorder: (orderedUserIds: string[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<StaffRankRow[]>(initialRows);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function moveBefore(fromId: string, toId: string) {
    if (fromId === toId) return;
    const next = [...rows];
    const fromIdx = next.findIndex((r) => r.userId === fromId);
    const toIdx = next.findIndex((r) => r.userId === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = next.splice(fromIdx, 1);
    const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
    next.splice(insertAt, 0, moved);
    setRows(next);
    startTransition(() => onReorder(next.map((r) => r.userId)));
  }

  if (rows.length === 0) {
    return (
      <div className="border rounded p-6 text-sm text-gray-500 bg-gray-50 text-center">
        No staff yet.
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-x-auto bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
          <tr className="border-b">
            <th className="text-left px-3 py-2 w-10"></th>
            <th className="text-left px-3 py-2 w-10">#</th>
            <th className="text-left px-3 py-2">Name</th>
            <th className="text-right px-3 py-2">Accept</th>
            <th className="text-right px-3 py-2">Response</th>
            <th className="text-right px-3 py-2">Avg reply</th>
            <th className="text-right px-3 py-2">Cancels</th>
            <th className="text-right px-3 py-2">No-shows</th>
            <th className="text-right px-3 py-2">Late</th>
            <th className="text-right px-3 py-2">On-call</th>
            <th className="text-right px-3 py-2">Hours</th>
            <th className="text-right px-3 py-2">Shifts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isDragging = draggingId === r.userId;
            const isHover = hoverId === r.userId && draggingId !== null && draggingId !== r.userId;
            return (
              <tr
                key={r.userId}
                draggable
                onDragStart={(e) => {
                  setDraggingId(r.userId);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", r.userId);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (hoverId !== r.userId) setHoverId(r.userId);
                }}
                onDragLeave={() => {
                  if (hoverId === r.userId) setHoverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingId && draggingId !== r.userId) moveBefore(draggingId, r.userId);
                  setDraggingId(null);
                  setHoverId(null);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setHoverId(null);
                }}
                className={`border-b last:border-b-0 cursor-move select-none transition-colors ${
                  isDragging ? "opacity-40" : ""
                } ${isHover ? "bg-blue-50 border-l-2 border-blue-500" : "hover:bg-gray-50"}`}
              >
                <td className="px-3 py-2 text-gray-400 leading-none" aria-hidden>⋮⋮</td>
                <td className="px-3 py-2 text-gray-600 text-xs">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/manager/staff/${r.userId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                    <div className="font-medium">{r.firstName} {r.lastName}</div>
                    <div className="text-xs text-gray-500">{r.city ?? ""}</div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right">{fmtPct(r.acceptPct)}</td>
                <td className="px-3 py-2 text-right">{fmtPct(r.responsePct)}</td>
                <td className="px-3 py-2 text-right">{fmtHours(r.avgResponseHours)}</td>
                <td className={`px-3 py-2 text-right ${r.cancelled > 0 ? "text-amber-700" : ""}`}>{r.cancelled}</td>
                <td className={`px-3 py-2 text-right ${r.noShows > 0 ? "text-red-600" : ""}`}>{r.noShows}</td>
                <td className={`px-3 py-2 text-right ${r.lateCount > 0 ? "text-amber-700" : ""}`}>{r.lateCount}</td>
                <td className="px-3 py-2 text-right">{fmtPct(r.activationPct)}</td>
                <td className="px-3 py-2 text-right">{r.totalHours.toFixed(0)}</td>
                <td className="px-3 py-2 text-right">{r.paidShiftCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtPct(v: number | null) { return v == null ? "—" : `${v.toFixed(0)}%`; }
function fmtHours(h: number | null) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} m`;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}
