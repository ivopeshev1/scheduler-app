"use client";

import { useState, useTransition } from "react";

type Role = { id: string; name: string };

/**
 * Drag-and-drop list for Settings → Roles. Uses the browser's native HTML5
 * drag API (no library) which gives us clean desktop reordering. On drop we
 * optimistically update local state and call the server action to persist.
 *
 * Native HTML5 DnD doesn't work on touch. If we ever need mobile drag, swap
 * to @dnd-kit/sortable — everything above the callbacks stays the same.
 */
export function RolesList({
  initialRoles,
  onReorder,
  onRemove,
}: {
  initialRoles: Role[];
  onReorder: (orderedIds: string[]) => Promise<void>;
  onRemove: (roleId: string) => Promise<void>;
}) {
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function moveBefore(fromId: string, toId: string) {
    if (fromId === toId) return;
    const next = [...roles];
    const fromIdx = next.findIndex((r) => r.id === fromId);
    const toIdx = next.findIndex((r) => r.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = next.splice(fromIdx, 1);
    // After the splice the target index shifts if we removed an earlier item.
    const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
    next.splice(insertAt, 0, moved);
    setRoles(next);
    startTransition(() => onReorder(next.map((r) => r.id)));
  }

  function remove(id: string) {
    setRoles((rs) => rs.filter((r) => r.id !== id));
    startTransition(() => onRemove(id));
  }

  if (roles.length === 0) {
    return (
      <div className="border rounded p-4 text-sm text-gray-500 bg-gray-50 mb-4">
        No roles yet. Add your first below.
      </div>
    );
  }

  return (
    <>
      <ul className="border rounded divide-y mb-4">
        {roles.map((r) => {
          const isDragging = draggingId === r.id;
          const isHover = hoverId === r.id && draggingId !== null && draggingId !== r.id;
          return (
            <li
              key={r.id}
              draggable
              onDragStart={(e) => {
                setDraggingId(r.id);
                e.dataTransfer.effectAllowed = "move";
                // Required for Firefox to actually start the drag
                e.dataTransfer.setData("text/plain", r.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverId !== r.id) setHoverId(r.id);
              }}
              onDragLeave={() => {
                // Only clear if we're leaving the currently-tracked hover
                if (hoverId === r.id) setHoverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingId && draggingId !== r.id) moveBefore(draggingId, r.id);
                setDraggingId(null);
                setHoverId(null);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setHoverId(null);
              }}
              className={`flex items-center gap-3 px-3 py-2 cursor-move select-none transition-colors ${
                isDragging ? "opacity-40" : ""
              } ${isHover ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
            >
              <span className="text-gray-400 text-sm leading-none" aria-hidden>⋮⋮</span>
              <span className="text-sm flex-1">{r.name}</span>
              <button
                type="button"
                onClick={() => remove(r.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-500 mb-4">
        Drag the rows to reorder. The order here is the order roles appear in event dropdowns.
      </p>
    </>
  );
}
