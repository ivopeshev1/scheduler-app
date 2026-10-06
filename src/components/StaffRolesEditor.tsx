"use client";

import { useState } from "react";

export type StaffRoleRow = {
  role: string;
  rate: string; // held as string so empty inputs don't force a 0
  rateType: "hourly" | "flat";
};

/**
 * Repeatable role + rate editor used on the staff edit form. Each row
 * is a role dropdown (from the company role catalog) + rate input +
 * flat/hourly dropdown + remove button. "Add role" at the bottom
 * appends a new blank row. On submit, the parent form reads the hidden
 * input named `staffRoles` which carries the JSON-encoded list.
 */
export function StaffRolesEditor({
  roleOptions,
  initial,
}: {
  roleOptions: string[];
  initial: StaffRoleRow[];
}) {
  const [rows, setRows] = useState<StaffRoleRow[]>(() =>
    initial.length > 0 ? initial : [{ role: roleOptions[0] ?? "", rate: "", rateType: "hourly" }]
  );

  function update(idx: number, patch: Partial<StaffRoleRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function remove(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }
  function add() {
    // Pick the first role not already used; fall back to the first option
    // in the catalog so duplicate rows are still editable to a new value.
    const used = new Set(rows.map((r) => r.role));
    const next = roleOptions.find((r) => !used.has(r)) ?? roleOptions[0] ?? "";
    setRows((prev) => [...prev, { role: next, rate: "", rateType: "hourly" }]);
  }

  return (
    <div>
      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select
              value={r.role}
              onChange={(e) => update(idx, { role: e.target.value })}
              className="input flex-1"
              required
            >
              {roleOptions.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
            </select>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 text-sm">$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={r.rate}
                onChange={(e) => update(idx, { rate: e.target.value })}
                className="input w-24"
                placeholder="0"
                required
              />
            </div>
            <select
              value={r.rateType}
              onChange={(e) => update(idx, { rateType: e.target.value as "hourly" | "flat" })}
              className="input w-24"
            >
              <option value="hourly">/hr</option>
              <option value="flat">flat</option>
            </select>
            <button
              type="button"
              onClick={() => remove(idx)}
              disabled={rows.length <= 1}
              className="text-sm text-red-600 hover:underline disabled:text-gray-300 disabled:no-underline shrink-0 px-2"
              title={rows.length <= 1 ? "At least one role is required" : "Remove this role"}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="btn btn-secondary text-sm mt-3"
        disabled={roleOptions.length === 0}
      >
        + Add role
      </button>
      <input type="hidden" name="staffRoles" value={JSON.stringify(rows)} />
    </div>
  );
}
