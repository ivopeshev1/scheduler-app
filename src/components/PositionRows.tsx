"use client";

import { useState } from "react";

const POSITION_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"] as const;

export function PositionRows() {
  const [count, setCount] = useState(1);

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded-lg p-3">
          <div className="col-span-1">
            <label className="label">#</label>
            <input name={`needed${i}`} type="number" min={1} defaultValue={1} className="input" />
          </div>
          <div className="col-span-3">
            <label className="label">Role</label>
            <select name={`role${i}`} className="input" defaultValue="">
              <option value="">—</option>
              {POSITION_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Mode</label>
            <select name={`mode${i}`} className="input" defaultValue="pool">
              <option value="pool">Pool</option>
              <option value="individual">Individual</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Base rate</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
              <input name={`baseRate${i}`} type="number" min={0} step="0.01" className="input pl-6" />
            </div>
          </div>
          <div className="col-span-2">
            <label className="label">Van add-on</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
              <input name={`vanRate${i}`} type="number" min={0} step="0.01" className="input pl-6" />
            </div>
          </div>
          <div className="col-span-2">
            <label className="label">Travel</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
              <input name={`travelRate${i}`} type="number" min={0} step="0.01" className="input pl-6" />
            </div>
          </div>
          <div className="col-span-12 flex items-center gap-2">
            <input id={`vanReq${i}`} name={`vanReq${i}`} type="checkbox" />
            <label htmlFor={`vanReq${i}`} className="text-xs">Requires van driving</label>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        className="w-full border border-dashed rounded-lg p-3 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-800"
      >
        + Add another position
      </button>
    </div>
  );
}
