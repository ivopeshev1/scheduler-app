"use client";

import { useState } from "react";
import { BaseRateControl } from "@/components/BaseRateControl";

export function PositionRows({ roles }: { roles: string[] }) {
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const [nextId, setNextId] = useState(1);

  return (
    <div className="space-y-3">
      {rowIds.map((id) => (
        <PositionRow
          key={id}
          index={id}
          roles={roles}
          onRemove={() => setRowIds((rows) => rows.filter((r) => r !== id))}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          setRowIds((prev) => [...prev, nextId]);
          setNextId((n) => n + 1);
        }}
        className="w-full border border-dashed rounded-lg p-3 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-800"
      >
        + Add another position
      </button>
      <p className="text-xs text-gray-500">
        Manage the role list under{" "}
        <a href="/manager/settings" className="underline">Settings → Roles</a>.
      </p>
    </div>
  );
}

function PositionRow({
  index,
  roles,
  onRemove,
}: {
  index: number;
  roles: string[];
  onRemove: () => void;
}) {
  // Default to Standard - managers already put each staff member's rate on file
  // at onboarding, so the common case is "use their onboarded rate".
  return (
    <div className="grid grid-cols-12 gap-3 items-end border rounded-lg p-3">
      <div className="col-span-1">
        <label className="label">#</label>
        <input name={`needed${index}`} type="number" min={1} defaultValue={1} className="input" />
      </div>
      <div className="col-span-5">
        <label className="label">Role</label>
        <select name={`role${index}`} className="input" defaultValue="" required>
          <option value="" disabled>-</option>
          {roles.map((r) => (<option key={r} value={r}>{r}</option>))}
        </select>
      </div>
      <div className="col-span-5">
        <label className="label">Base rate</label>
        <BaseRateControl
          baseRateFieldName={`baseRate${index}`}
          baseRateModeFieldName={`baseRateMode${index}`}
          defaultMode="standard"
          defaultAmount=""
        />
      </div>
      <div className="col-span-1 pb-1 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="text-red-600 hover:bg-red-50 text-lg w-8 h-8 rounded border border-red-200 flex items-center justify-center"
          title="Remove row"
          aria-label="Remove row"
        >
          ×
        </button>
      </div>
    </div>
  );
}
