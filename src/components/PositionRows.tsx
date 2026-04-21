"use client";

import { useState } from "react";

const POSITION_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"] as const;

export function PositionRows() {
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const [nextId, setNextId] = useState(1);
  // Only one row may be the van-driver; tracked here at parent level
  const [vanDriverRow, setVanDriverRow] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {rowIds.map((id) => (
        <PositionRow
          key={id}
          index={id}
          isVanDriver={vanDriverRow === id}
          onToggleVan={(checked) => setVanDriverRow(checked ? id : null)}
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
        Only one position can be designated the van driver per event.
      </p>
    </div>
  );
}

function PositionRow({
  index,
  isVanDriver,
  onToggleVan,
}: {
  index: number;
  isVanDriver: boolean;
  onToggleVan: (checked: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-end border rounded-lg p-3">
      <div className="col-span-1">
        <label className="label">#</label>
        <input name={`needed${index}`} type="number" min={1} defaultValue={1} className="input" />
      </div>
      <div className="col-span-3">
        <label className="label">Role</label>
        <select name={`role${index}`} className="input" defaultValue="">
          <option value="">—</option>
          {POSITION_ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="col-span-2">
        <label className="label">Base rate</label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
          <input name={`baseRate${index}`} type="number" min={0} step="0.01" className="input pl-6" />
        </div>
      </div>
      <div className="col-span-2">
        <label className="label">Van add-on</label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
          <input name={`vanRate${index}`} type="number" min={0} step="0.01" className="input pl-6" />
        </div>
      </div>
      <div className="col-span-2">
        <label className="label">Travel</label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
          <input name={`travelRate${index}`} type="number" min={0} step="0.01" className="input pl-6" />
        </div>
      </div>
      <div className="col-span-2 flex items-center gap-2 pb-2">
        <input
          id={`vanReq${index}`}
          name={`vanReq${index}`}
          type="checkbox"
          checked={isVanDriver}
          onChange={(e) => onToggleVan(e.target.checked)}
        />
        <label htmlFor={`vanReq${index}`} className="text-xs">Requires van driving</label>
      </div>
    </div>
  );
}
