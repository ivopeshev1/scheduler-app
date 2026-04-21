"use client";

import { useState } from "react";

const POSITION_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"] as const;

type PositionData = {
  id: string;
  role: "Bar Lead" | "Bar Back" | "Bartender" | "Server" | "Cashier";
  needed: number;
  baseRate: number | null;
  vanDrivingRate: number | null;
  travelRate: number | null;
  requiresVanDriving: boolean;
};

export function EditPositionRow({ p }: { p: PositionData }) {
  const [removed, setRemoved] = useState(false);
  const key = p.id;

  if (removed) {
    return (
      <div className="border-2 border-red-300 bg-red-50 rounded-lg p-3 flex items-center justify-between">
        <div className="text-sm">
          <span className="text-red-700 font-medium">Will be removed:</span>{" "}
          {p.role} ({p.needed} needed).{" "}
          <span className="text-xs text-gray-600">
            Invited staff will be notified on save.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setRemoved(false)}
          className="btn btn-secondary text-xs"
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <details open className="border rounded-lg p-3">
      <summary className="cursor-pointer text-sm font-medium mb-2 flex items-center justify-between">
        <span>{p.role} · {p.needed} needed · ${p.baseRate ?? 0}</span>
      </summary>
      <div className="grid grid-cols-12 gap-2 items-end mt-3">
        <div className="col-span-1">
          <label className="label">#</label>
          <input name={`needed[${key}]`} type="number" min={1} defaultValue={p.needed} className="input" />
        </div>
        <div className="col-span-3">
          <label className="label">Role</label>
          <select name={`role[${key}]`} className="input" defaultValue={p.role}>
            {POSITION_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Base rate</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`baseRate[${key}]`} type="number" min={0} step="0.01" defaultValue={p.baseRate ?? ""} className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2">
          <label className="label">Van add-on</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`vanRate[${key}]`} type="number" min={0} step="0.01" defaultValue={p.vanDrivingRate ?? ""} className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2">
          <label className="label">Travel</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`travelRate[${key}]`} type="number" min={0} step="0.01" defaultValue={p.travelRate ?? ""} className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2 flex items-center gap-2 pb-2">
          <input id={`vanReq[${key}]`} name={`vanReq[${key}]`} type="checkbox" defaultChecked={p.requiresVanDriving} />
          <label htmlFor={`vanReq[${key}]`} className="text-xs">Requires van driving</label>
        </div>
        <div className="col-span-12 flex justify-end">
          <button
            type="button"
            onClick={() => setRemoved(true)}
            className="text-red-600 hover:bg-red-50 text-sm px-3 py-1 rounded border border-red-200"
          >
            Remove this position
          </button>
        </div>
      </div>
    </details>
  );
}
