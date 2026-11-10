"use client";

import { useState, useTransition } from "react";

export type AddOn = {
  id: string;
  name: string;
  includeDescription: boolean;
  highlightInInvite: boolean;
};

/**
 * Drag-reorderable list of add-on tasks for Settings → Add-ons. Compensation
 * was dropped from the add-on template — the manager types the $ amount
 * per-person at invite time, so the list only surfaces name + whether this
 * add-on shows a description textarea on the event setup page.
 */
export function AddOnsList({
  initialAddOns,
  onReorder,
  onRemove,
  onToggleHighlight,
}: {
  initialAddOns: AddOn[];
  onReorder: (orderedIds: string[]) => Promise<void>;
  onRemove: (addOnId: string) => Promise<void>;
  onToggleHighlight: (addOnId: string, next: boolean) => Promise<void>;
}) {
  const [addOns, setAddOns] = useState<AddOn[]>(initialAddOns);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function moveBefore(fromId: string, toId: string) {
    if (fromId === toId) return;
    const next = [...addOns];
    const fromIdx = next.findIndex((a) => a.id === fromId);
    const toIdx = next.findIndex((a) => a.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = next.splice(fromIdx, 1);
    const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
    next.splice(insertAt, 0, moved);
    setAddOns(next);
    startTransition(() => onReorder(next.map((a) => a.id)));
  }

  function remove(id: string) {
    setAddOns((xs) => xs.filter((a) => a.id !== id));
    startTransition(() => onRemove(id));
  }

  // Empty state: render nothing — the "Add a new add-on" form sits right
  // below this, so a separate placeholder would just add noise.
  if (addOns.length === 0) return null;

  return (
    <>
      <ul className="border rounded divide-y mb-4">
        {addOns.map((a) => {
          const isDragging = draggingId === a.id;
          const isHover = hoverId === a.id && draggingId !== null && draggingId !== a.id;
          return (
            <li
              key={a.id}
              draggable
              onDragStart={(e) => {
                setDraggingId(a.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", a.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverId !== a.id) setHoverId(a.id);
              }}
              onDragLeave={() => {
                if (hoverId === a.id) setHoverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingId && draggingId !== a.id) moveBefore(draggingId, a.id);
                setDraggingId(null);
                setHoverId(null);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setHoverId(null);
              }}
              className={`flex items-center gap-3 px-3 py-2.5 cursor-move select-none transition-colors ${
                isDragging ? "opacity-40" : ""
              } ${isHover ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
            >
              <span className="text-gray-400 text-sm leading-none" aria-hidden>⋮⋮</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                  {a.name}
                  {a.highlightInInvite && (
                    <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                      Shift requirement
                    </span>
                  )}
                </div>
                {a.includeDescription && (
                  <div className="text-xs text-gray-500">Includes description box</div>
                )}
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none" title="Treat as a shift requirement (highlighted in invite emails)">
                <input
                  type="checkbox"
                  checked={a.highlightInInvite}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setAddOns((xs) => xs.map((x) => (x.id === a.id ? { ...x, highlightInInvite: next } : x)));
                    startTransition(() => onToggleHighlight(a.id, next));
                  }}
                  className="w-4 h-4"
                  onClick={(e) => e.stopPropagation()}
                />
                <span>Requirement</span>
              </label>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-500 mb-4">
        Drag rows to reorder. Add-ons appear on the staff picker in this order.
      </p>
    </>
  );
}
