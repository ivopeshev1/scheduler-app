"use client";

import { useState } from "react";

export type StaffRoleRow = {
  role: string;
  rate: string; // held as string so empty inputs don't force a 0
  rateType: "hourly" | "flat";
};

const ADD_NEW_SENTINEL = "__add_new__";

/**
 * Repeatable role + rate editor used on the staff edit + Add Staff forms.
 * Each row is a role dropdown (from the company role catalog) + rate input +
 * flat/hourly dropdown + remove button. "Add role" at the bottom
 * appends a new blank row. On submit, the parent form reads the hidden
 * input named `staffRoles` which carries the JSON-encoded list.
 *
 * The dropdown has a special "+ Add new role" option at the bottom. Picking it
 * swaps the row's dropdown for a small inline "type the name" input and OK /
 * cancel buttons. OK adds the name to the local options list AND to the
 * row, so it's selected immediately. The parent server action is responsible
 * for upserting any role name not already in the company catalog when it
 * reads back `staffRoles` — nothing is persisted from this component alone.
 */
export function StaffRolesEditor({
  roleOptions: initialOptions,
  initial,
}: {
  roleOptions: string[];
  initial: StaffRoleRow[];
}) {
  const [rows, setRows] = useState<StaffRoleRow[]>(() =>
    initial.length > 0 ? initial : [{ role: "", rate: "", rateType: "hourly" }]
  );
  // Keep options in local state so a freshly-typed new role appears in every
  // row's dropdown, not just the one where it was added.
  const [options, setOptions] = useState<string[]>(initialOptions);
  // Per-row "typing a new role name" draft state. idx -> current draft text.
  const [newDrafts, setNewDrafts] = useState<Record<number, string>>({});

  function update(idx: number, patch: Partial<StaffRoleRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function remove(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setNewDrafts((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }
  function add() {
    setRows((prev) => [...prev, { role: "", rate: "", rateType: "hourly" }]);
  }

  function startAddingNew(idx: number) {
    setNewDrafts((prev) => ({ ...prev, [idx]: "" }));
  }
  function cancelAddingNew(idx: number) {
    setNewDrafts((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
    update(idx, { role: "" });
  }
  function confirmNewRole(idx: number) {
    const name = (newDrafts[idx] ?? "").trim();
    if (!name) return;
    // De-dupe case-insensitively but keep the catalog's casing if it already exists.
    const existing = options.find((o) => o.toLowerCase() === name.toLowerCase());
    const finalName = existing ?? name;
    if (!existing) setOptions((prev) => [...prev, finalName]);
    update(idx, { role: finalName });
    cancelAddingNew(idx);
  }

  return (
    <div>
      <div className="space-y-3">
        {rows.map((r, idx) => {
          const addingNew = newDrafts[idx] !== undefined;
          return (
            <div key={idx} className="flex items-end gap-3">
              {/* Role: widest column with its own label on top */}
              <div className="flex-1 min-w-0">
                {idx === 0 && <label className="label">Role</label>}
                {addingNew ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newDrafts[idx]}
                      onChange={(e) =>
                        setNewDrafts((prev) => ({ ...prev, [idx]: e.target.value }))
                      }
                      autoFocus
                      placeholder="New role name (e.g. Sommelier)"
                      className="input w-full"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmNewRole(idx);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelAddingNew(idx);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => confirmNewRole(idx)}
                      className="text-sm underline text-gray-700 hover:text-black"
                      title="Add this role"
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelAddingNew(idx)}
                      className="text-sm text-gray-500 hover:underline"
                      title="Cancel"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <select
                    value={r.role}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === ADD_NEW_SENTINEL) {
                        startAddingNew(idx);
                      } else {
                        update(idx, { role: v });
                      }
                    }}
                    className="input w-full"
                    required
                  >
                    <option value="" disabled>Select here</option>
                    {options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                    <option value={ADD_NEW_SENTINEL}>+ Add new role…</option>
                  </select>
                )}
              </div>
              {/* Rate: label on top */}
              <div className="shrink-0 w-24">
                {idx === 0 && <label className="label">Rate</label>}
                <div className="flex items-center gap-1">
                  <span className="text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={r.rate}
                    onChange={(e) => update(idx, { rate: e.target.value })}
                    className="input w-full"
                    placeholder="0"
                    required
                  />
                </div>
              </div>
              {/* Unit picker: matches rate column width */}
              <div className="shrink-0 w-24">
                {idx === 0 && <div className="label invisible">unit</div>}
                <select
                  value={r.rateType}
                  onChange={(e) => update(idx, { rateType: e.target.value as "hourly" | "flat" })}
                  className="input w-full text-sm"
                >
                  <option value="hourly">/hr</option>
                  <option value="flat">flat</option>
                </select>
              </div>
              <div className="shrink-0 pb-[6px]">
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  disabled={rows.length <= 1}
                  className="text-sm text-red-600 hover:underline disabled:text-gray-300 disabled:no-underline px-2"
                  title={rows.length <= 1 ? "At least one role is required" : "Remove this role"}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={add}
        className="btn btn-secondary text-sm mt-3"
      >
        + Add role
      </button>
      <input type="hidden" name="staffRoles" value={JSON.stringify(rows)} />
    </div>
  );
}
