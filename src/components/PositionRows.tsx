"use client";

import { useState } from "react";
import { BaseRateControl } from "@/components/BaseRateControl";

const POSITION_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"] as const;

export function PositionRows() {
  const [rowIds, setRowIds] = useState<number[]>([0]);
  const [nextId, setNextId] = useState(1);
  const [vanDriverRow, setVanDriverRow] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {/* Shared datalist for role suggestions — input also accepts custom typed values */}
      <datalist id="role-suggestions">
        {POSITION_ROLES.map((r) => (<option key={r} value={r} />))}
      </datalist>
      {rowIds.map((id) => (
        <PositionRow
          key={id}
          index={id}
          isVanDriver={vanDriverRow === id}
          onToggleVan={(checked) => setVanDriverRow(checked ? id : null)}
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
      <p className="text-xs text-gray-500">Only one position can be designated the van driver per event.</p>
    </div>
  );
}

function MoneyInput({ name, defaultValue }: { name: string; defaultValue?: number | string }) {
  return (
    <div className="flex items-stretch border border-gray-300 rounded-md focus-within:border-gray-500 focus-within:ring-2 focus-within:ring-gray-200 max-w-[110px]">
      <span className="flex items-center px-2 text-gray-500 text-sm bg-gray-50 border-r border-gray-300 rounded-l-md">$</span>
      <input
        name={name}
        type="number"
        min={0}
        step="0.01"
        defaultValue={defaultValue}
        className="flex-1 min-w-0 px-2 py-2 text-sm rounded-r-md outline-none"
      />
    </div>
  );
}

function PositionRow({
  index,
  isVanDriver,
  onToggleVan,
  onRemove,
}: {
  index: number;
  isVanDriver: boolean;
  onToggleVan: (checked: boolean) => void;
  onRemove: () => void;
}) {
  // Default to Standard — managers already put each staff member's rate on file
  // at onboarding, so the common case is "use their onboarded rate".
  return (
    <div className="grid grid-cols-12 gap-3 items-end border rounded-lg p-3">
      <div className="col-span-1">
        <label className="label">#</label>
        <input name={`needed${index}`} type="number" min={1} defaultValue={1} className="input" />
      </div>
      <div className="col-span-3">
        <label className="label">Role</label>
        <input
          name={`role${index}`}
          list="role-suggestions"
          autoComplete="off"
          className="input"
          placeholder="type or pick…"
        />
      </div>
      <div className="col-span-2">
        <label className="label">Base rate</label>
        <BaseRateControl
          baseRateFieldName={`baseRate${index}`}
          baseRateModeFieldName={`baseRateMode${index}`}
          defaultMode="standard"
          defaultAmount=""
        />
      </div>
      <div className="col-span-2">
        <label className="label">Van add-on</label>
        <MoneyInput name={`vanRate${index}`} />
      </div>
      <div className="col-span-2">
        <label className="label">Travel</label>
        <MoneyInput name={`travelRate${index}`} />
      </div>
      <div className="col-span-1 flex items-center gap-1 pb-2">
        <input
          id={`vanReq${index}`}
          name={`vanReq${index}`}
          type="checkbox"
          checked={isVanDriver}
          onChange={(e) => onToggleVan(e.target.checked)}
        />
        <label htmlFor={`vanReq${index}`} className="text-xs">Van</label>
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
