"use client";

import { useState } from "react";

const POSITION_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"] as const;

export type InvitedStaff = {
  userId: string;
  firstName: string;
  lastName: string;
  status: "pending" | "accepted" | "rejected" | "expired" | "filled";
};

export type PositionData = {
  id: string;
  role: "Bar Lead" | "Bar Back" | "Bartender" | "Server" | "Cashier";
  needed: number;
  baseRate: number | null;
  vanDrivingRate: number | null;
  travelRate: number | null;
  requiresVanDriving: boolean;
  invitedStaff: InvitedStaff[];
};

type Removal = {
  mode: "all" | "partial"; // all = delete whole position; partial = reduce slot count + un-invite picked users
  unInviteUserIds: string[];
};

export function PositionsEditor({ positions }: { positions: PositionData[] }) {
  const [newRows, setNewRows] = useState<number[]>([]);
  const [nextNewId, setNextNewId] = useState(0);

  // Van driver: which row (existing position id OR `new-N`) is the single van driver
  const initialVan = positions.find((p) => p.requiresVanDriving)?.id ?? null;
  const [vanKey, setVanKey] = useState<string | null>(initialVan);

  // Removals, keyed by existing position id
  const [removals, setRemovals] = useState<Record<string, Removal>>({});
  // Which row's removal modal is open
  const [modalKey, setModalKey] = useState<string | null>(null);

  function openModal(key: string) { setModalKey(key); }
  function closeModal() { setModalKey(null); }

  function applyRemoval(key: string, r: Removal) {
    setRemovals((prev) => ({ ...prev, [key]: r }));
    closeModal();
  }

  function undoRemoval(key: string) {
    setRemovals((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  return (
    <div className="space-y-3">
      {positions.map((p) => {
        const r = removals[p.id];
        const isVan = vanKey === p.id;
        return (
          <ExistingRow
            key={p.id}
            p={p}
            removal={r}
            onOpenRemoveModal={() => openModal(p.id)}
            onUndoRemoval={() => undoRemoval(p.id)}
            isVan={isVan}
            onToggleVan={(on) => setVanKey(on ? p.id : null)}
          />
        );
      })}

      {newRows.map((id) => {
        const k = `new-${id}`;
        const isVan = vanKey === k;
        return (
          <NewRow
            key={k}
            newKey={k}
            isVan={isVan}
            onToggleVan={(on) => setVanKey(on ? k : null)}
            onRemove={() => setNewRows((rows) => rows.filter((r) => r !== id))}
          />
        );
      })}

      <button
        type="button"
        onClick={() => {
          setNewRows((rows) => [...rows, nextNewId]);
          setNextNewId((n) => n + 1);
        }}
        className="w-full border border-dashed rounded-lg p-3 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-800"
      >
        + Add another position
      </button>

      <p className="text-xs text-gray-500">
        Only one position per event can be designated the van driver.
      </p>

      {modalKey && (
        <RemoveModal
          position={positions.find((p) => p.id === modalKey)!}
          initial={removals[modalKey]}
          onCancel={closeModal}
          onApply={(r) => applyRemoval(modalKey, r)}
        />
      )}
    </div>
  );
}

/* -------------------- existing row -------------------- */

function ExistingRow({
  p,
  removal,
  onOpenRemoveModal,
  onUndoRemoval,
  isVan,
  onToggleVan,
}: {
  p: PositionData;
  removal: Removal | undefined;
  onOpenRemoveModal: () => void;
  onUndoRemoval: () => void;
  isVan: boolean;
  onToggleVan: (on: boolean) => void;
}) {
  const key = p.id;

  // If fully removed, render a red banner and omit all form fields (server deletes)
  if (removal?.mode === "all") {
    return (
      <div className="border-2 border-red-300 bg-red-50 rounded-lg p-3 flex items-center justify-between">
        <div className="text-sm">
          <span className="text-red-700 font-medium">Will be removed:</span>{" "}
          {p.role} ({p.needed} slot{p.needed > 1 ? "s" : ""}).{" "}
          {p.invitedStaff.length > 0 && (
            <span className="text-xs text-gray-600">{p.invitedStaff.length} staff will be notified.</span>
          )}
        </div>
        <button type="button" onClick={onUndoRemoval} className="btn btn-secondary text-xs">Undo</button>
      </div>
    );
  }

  // Partial removal: reduce needed, un-invite picked users
  const partiallyRemoved = removal?.mode === "partial";
  const reducedNeeded = partiallyRemoved ? p.needed - (removal!.unInviteUserIds.length) : p.needed;

  return (
    <>
      <div className={`grid grid-cols-12 gap-2 items-end border rounded-lg p-3 ${partiallyRemoved ? "border-amber-300 bg-amber-50" : ""}`}>
        <div className="col-span-1">
          <label className="label">#</label>
          <input name={`needed[${key}]`} type="number" min={1} defaultValue={reducedNeeded} className="input" />
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
        <div className="col-span-1 flex items-center gap-1 pb-2">
          <input
            id={`vanReq[${key}]`}
            name={`vanReq[${key}]`}
            type="checkbox"
            checked={isVan}
            onChange={(e) => onToggleVan(e.target.checked)}
          />
          <label htmlFor={`vanReq[${key}]`} className="text-xs">Van</label>
        </div>
        <div className="col-span-1 pb-1 flex justify-end">
          <button
            type="button"
            onClick={onOpenRemoveModal}
            className="text-red-600 hover:bg-red-50 text-lg w-8 h-8 rounded border border-red-200 flex items-center justify-center"
            title="Remove"
            aria-label="Remove"
          >
            ×
          </button>
        </div>
      </div>

      {/* Hidden fields: track which users are being un-invited for this position */}
      {partiallyRemoved && removal!.unInviteUserIds.map((uid) => (
        <input key={uid} type="hidden" name={`unInvite[${key}]`} value={uid} />
      ))}

      {partiallyRemoved && (
        <div className="text-xs text-amber-800 pl-3">
          Reduced to {reducedNeeded} slot{reducedNeeded === 1 ? "" : "s"}. Un-inviting:{" "}
          {removal!.unInviteUserIds
            .map((uid) => p.invitedStaff.find((s) => s.userId === uid))
            .filter(Boolean)
            .map((s) => `${s!.firstName} ${s!.lastName}`)
            .join(", ")}
          .{" "}
          <button type="button" onClick={onUndoRemoval} className="underline">Undo</button>
        </div>
      )}
    </>
  );
}

/* -------------------- new row -------------------- */

function NewRow({
  newKey,
  isVan,
  onToggleVan,
  onRemove,
}: {
  newKey: string;
  isVan: boolean;
  onToggleVan: (on: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-end border border-dashed rounded-lg p-3">
      <div className="col-span-1">
        <label className="label">#</label>
        <input name={`needed[${newKey}]`} type="number" min={1} defaultValue={1} className="input" />
      </div>
      <div className="col-span-3">
        <label className="label">Role</label>
        <select name={`role[${newKey}]`} className="input" defaultValue="">
          <option value="">—</option>
          {POSITION_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
        </select>
      </div>
      <div className="col-span-2">
        <label className="label">Base rate</label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
          <input name={`baseRate[${newKey}]`} type="number" min={0} step="0.01" className="input pl-6" />
        </div>
      </div>
      <div className="col-span-2">
        <label className="label">Van add-on</label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
          <input name={`vanRate[${newKey}]`} type="number" min={0} step="0.01" className="input pl-6" />
        </div>
      </div>
      <div className="col-span-2">
        <label className="label">Travel</label>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
          <input name={`travelRate[${newKey}]`} type="number" min={0} step="0.01" className="input pl-6" />
        </div>
      </div>
      <div className="col-span-1 flex items-center gap-1 pb-2">
        <input
          id={`vanReq[${newKey}]`}
          name={`vanReq[${newKey}]`}
          type="checkbox"
          checked={isVan}
          onChange={(e) => onToggleVan(e.target.checked)}
        />
        <label htmlFor={`vanReq[${newKey}]`} className="text-xs">Van</label>
      </div>
      <div className="col-span-1 pb-1 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="text-red-600 hover:bg-red-50 text-lg w-8 h-8 rounded border border-red-200 flex items-center justify-center"
          title="Remove row"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/* -------------------- remove modal -------------------- */

function RemoveModal({
  position,
  initial,
  onCancel,
  onApply,
}: {
  position: PositionData;
  initial: Removal | undefined;
  onCancel: () => void;
  onApply: (r: Removal) => void;
}) {
  // Pre-select un-invite candidates based on prior state or default to all
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (initial) return new Set(initial.unInviteUserIds);
    return new Set(position.invitedStaff.map((s) => s.userId));
  });
  const allSelected = position.invitedStaff.length > 0 && selected.size === position.invitedStaff.length;

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(position.invitedStaff.map((s) => s.userId)));
  }
  function selectNone() {
    setSelected(new Set());
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
        <h3 className="text-lg font-semibold mb-2">Remove {position.role} position</h3>
        <p className="text-sm text-gray-600 mb-4">
          Currently needs {position.needed} slot{position.needed === 1 ? "" : "s"}.
          {position.invitedStaff.length > 0 && (
            <> {position.invitedStaff.length} invited so far.</>
          )}
        </p>

        {position.invitedStaff.length === 0 ? (
          <div className="border rounded p-3 bg-gray-50 text-sm text-gray-700 mb-4">
            No one is invited to this position yet. Removing will just delete it from the event.
          </div>
        ) : (
          <>
            <div className="text-sm font-medium mb-2">Un-invite who?</div>
            <div className="flex gap-2 mb-2 text-xs">
              <button type="button" onClick={selectAll} className="underline text-gray-600">Select all</button>
              <button type="button" onClick={selectNone} className="underline text-gray-600">Clear</button>
            </div>
            <div className="border rounded max-h-64 overflow-y-auto">
              {position.invitedStaff.map((s) => (
                <label key={s.userId} className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 text-sm hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(s.userId)}
                    onChange={() => toggle(s.userId)}
                    className="w-4 h-4"
                  />
                  <span className="flex-1">{s.firstName} {s.lastName}</span>
                  <span className="text-xs text-gray-500 capitalize">{s.status}</span>
                </label>
              ))}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              {allSelected
                ? "Removing everyone. The whole position will be deleted."
                : selected.size === 0
                ? "Keeping all invitees. Nothing will change."
                : `${selected.size} will be un-invited (and notified). Position slots will drop to ${position.needed - selected.size}.`}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
          <button
            type="button"
            onClick={() => {
              if (position.invitedStaff.length === 0 || allSelected) {
                onApply({ mode: "all", unInviteUserIds: [] });
              } else if (selected.size === 0) {
                onCancel(); // nothing to do
              } else {
                onApply({ mode: "partial", unInviteUserIds: Array.from(selected) });
              }
            }}
            className="btn btn-primary"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
