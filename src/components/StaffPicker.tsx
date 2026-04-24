"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export type StaffOption = {
  userId: string;
  firstName: string;
  lastName: string;
  city: string | null;
  position: "Lead" | "Bartender" | "Bar Back" | "Server" | "Cashier";
  defaultRate: number | null;
  defaultRateType: "hourly" | "flat" | "both" | null;
  currentTier: number | null;
  currentStatus: "pending" | "accepted" | "rejected" | "expired" | "filled" | null;
  // Travel comp already stored on THIS invitation, if any
  currentTravelRate: number | null;
  // If set, this staff member is already invited/accepted elsewhere - show but make un-selectable
  busyWith: { eventDate: string; clientName: string; role: string } | null;
};

export type AddOnOption = {
  id: string;
  name: string;
};

export type AddOnAssignment = {
  id: string;
  amount: number | null;
};

type Props = {
  positionId: string;
  eventId: string;
  role: string;
  needed: number;
  mode: "pool" | "individual";
  staff: StaffOption[];
  onSave: (formData: FormData) => void;
  // Company-configured add-on tasks (van driver, setup crew, etc). Rendered
  // inline next to Travel on each invited staff row.
  companyAddOns: AddOnOption[];
  // Per-user list of {addOnId, amount} rows persisted from a previous save;
  // used to seed the inline checkbox + $ state so existing assignments stay
  // checked on re-open.
  currentAddOnsByUserId: Record<string, AddOnAssignment[]>;
};

const TIER_LABELS = ["Priority", "Backup 1", "Backup 2", "Backup 3"] as const;

export function StaffPicker({ positionId, eventId, role, needed, mode, staff, onSave, companyAddOns, currentAddOnsByUserId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [selections, setSelections] = useState<Record<string, number | null>>(() => {
    const init: Record<string, number | null> = {};
    for (const s of staff) init[s.userId] = s.currentTier;
    return init;
  });
  // Per-invitee travel rate, keyed by userId. "" or undefined = no travel.
  const [travelRates, setTravelRates] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of staff) {
      init[s.userId] = s.currentTravelRate != null ? String(s.currentTravelRate) : "";
    }
    return init;
  });
  // Travel is "checked" when there's a non-empty value OR it was previously
  // set on the invite. We keep this as a separate piece of state so the
  // checkbox can toggle independently of the $ input (empty string but still
  // checked = "intentionally 0 for travel").
  const [travelChecked, setTravelChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of staff) init[s.userId] = s.currentTravelRate != null;
    return init;
  });
  // Per-invitee add-on assignments: userId → Map of addOnId → amount string.
  // Presence in the map = add-on is checked for this user. Amount can be
  // blank (treated as $0 on save).
  const [addOnAssignments, setAddOnAssignments] = useState<Record<string, Map<string, string>>>(() => {
    const init: Record<string, Map<string, string>> = {};
    for (const s of staff) {
      const m = new Map<string, string>();
      for (const id of currentAddOnsByUserId[s.userId]?.keys ?? []) {
        m.set(id, "");
      }
      // currentAddOnsByUserId shape is Record<string, Array<{id,amount}>>
      const existing = currentAddOnsByUserId[s.userId] ?? [];
      for (const a of existing) {
        m.set(a.id, a.amount != null ? String(a.amount) : "");
      }
      init[s.userId] = m;
    }
    return init;
  });
  // Re-sync selections, travel rates, and add-on assignments when the server
  // sends fresh staff props, BUT only when the modal is closed - otherwise
  // we'd clobber the user's in-progress edits every time React re-renders.
  useEffect(() => {
    if (open) return;
    const nextSel: Record<string, number | null> = {};
    const nextTravel: Record<string, string> = {};
    const nextTravelChecked: Record<string, boolean> = {};
    const nextAddOns: Record<string, Map<string, string>> = {};
    for (const s of staff) {
      nextSel[s.userId] = s.currentTier;
      nextTravel[s.userId] = s.currentTravelRate != null ? String(s.currentTravelRate) : "";
      nextTravelChecked[s.userId] = s.currentTravelRate != null;
      const m = new Map<string, string>();
      const existing = currentAddOnsByUserId[s.userId] ?? [];
      for (const a of existing) {
        m.set(a.id, a.amount != null ? String(a.amount) : "");
      }
      nextAddOns[s.userId] = m;
    }
    setSelections(nextSel);
    setTravelRates(nextTravel);
    setTravelChecked(nextTravelChecked);
    setAddOnAssignments(nextAddOns);
  }, [staff, open, currentAddOnsByUserId]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const s of staff) if (s.city) set.add(s.city);
    return Array.from(set).sort();
  }, [staff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff
      .slice()
      .sort((a, b) => a.firstName.localeCompare(b.firstName))
      .filter((s) => {
        if (cityFilter !== "all" && s.city !== cityFilter) return false;
        if (!q) return true;
        return s.firstName.toLowerCase().includes(q) || s.lastName.toLowerCase().includes(q);
      });
  }, [staff, search, cityFilter]);

  const invitedCount = Object.values(selections).filter((t) => t !== null && t !== undefined).length;
  const priorityCount = Object.values(selections).filter((t) => t === 0).length;

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input text-left flex items-center justify-between gap-2 min-w-[220px]"
      >
        <span>{invitedCount === 0 ? "Invite staff…" : `${invitedCount} invited (${priorityCount} priority)`}</span>
        <span className="text-gray-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-[540px] bg-white border rounded-lg shadow-lg p-3 left-0">
          {/* Header row with Close/Save buttons on the right so the manager can
              act without scrolling past the staff list. */}
          <form
            action={async (formData) => {
              formData.set("eventId", eventId);
              formData.set("positionId", positionId);
              formData.set("selections", JSON.stringify(selections));
              // Serialize per-invitee travel rates. An unchecked Travel box
              // means the user explicitly opted out — send null. Checked +
              // blank means $0 (send "" so server parses as null, treated
              // as $0). Checked + value means the typed amount.
              const serializedTravel: Record<string, string> = {};
              for (const s of staff) {
                if (travelChecked[s.userId]) {
                  serializedTravel[s.userId] = travelRates[s.userId] ?? "";
                }
                // Unchecked = key omitted entirely; server treats as null.
              }
              formData.set("travelRates", JSON.stringify(serializedTravel));
              // Serialize add-on assignments as { userId: [{id, amount}] }.
              const assignments: Record<string, Array<{ id: string; amount: string }>> = {};
              for (const [uid, m] of Object.entries(addOnAssignments)) {
                const list: Array<{ id: string; amount: string }> = [];
                for (const [addOnId, amount] of m.entries()) {
                  list.push({ id: addOnId, amount });
                }
                assignments[uid] = list;
              }
              formData.set("addOnAssignments", JSON.stringify(assignments));
              await onSave(formData);
              router.refresh();
              setOpen(false);
            }}
            className="flex items-center justify-between gap-3 mb-3 pb-3 border-b"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Invite {role}s</div>
              <div className="text-xs text-gray-500 truncate">
                Needs {needed} · first-accept-wins ·{" "}
                {priorityCount > 0
                  ? `${priorityCount} priority invite${priorityCount > 1 ? "s" : ""} will email immediately`
                  : "backups are silent until triggered"}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">Close</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>

          <input type="text" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} className="input mb-2" autoFocus />

          {cities.length > 0 && (
            <div className="flex gap-1 mb-3 flex-wrap">
              <CityPill label="All cities" active={cityFilter === "all"} onClick={() => setCityFilter("all")} />
              {cities.map((c) => (<CityPill key={c} label={c} active={cityFilter === c} onClick={() => setCityFilter(c)} />))}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto border rounded">
            {filtered.length === 0 ? (
              <div className="p-4 text-sm text-gray-400 text-center">No {role.toLowerCase()}s match{search ? ` "${search}"` : ""}{cityFilter !== "all" ? ` in ${cityFilter}` : ""}.</div>
            ) : (
              filtered.map((s) => {
                const tier = selections[s.userId];
                const alreadyOnThisPosition = s.currentTier !== null && s.currentTier !== undefined;
                // Lock rules:
                //  - If staff is already on THIS position → always unlocked (manager needs to be able to remove them)
                //  - Otherwise, lock if they're busy elsewhere on this date, or they rejected a prior invite here
                const locked = !alreadyOnThisPosition && (!!s.busyWith || s.currentStatus === "rejected");
                const checked = tier !== null && tier !== undefined;
                const assignedAddOns = addOnAssignments[s.userId] ?? new Map<string, string>();
                const tChecked = travelChecked[s.userId] ?? false;
                return (
                  <label key={s.userId} className={`block px-3 py-2 border-b last:border-b-0 text-sm ${locked ? "opacity-50 cursor-not-allowed bg-gray-50" : "hover:bg-gray-50 cursor-pointer"}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <input type="checkbox" checked={checked} disabled={locked} onChange={(e) => {
                        if (locked) return;
                        setSelections((prev) => ({ ...prev, [s.userId]: e.target.checked ? (tier ?? 0) : null }));
                      }} className="w-4 h-4 shrink-0" />
                      <div className="flex-1 min-w-[180px]">
                        <div className="font-medium flex items-center gap-2">
                          {s.firstName} {s.lastName}
                          <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {s.position}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {s.city ?? "-"}
                          {s.defaultRate ? ` · $${s.defaultRate}${s.defaultRateType === "hourly" ? "/hr" : ""}` : ""}
                          {s.currentStatus === "accepted" && <span className="ml-2 text-status-confirmed font-medium">Accepted</span>}
                          {s.currentStatus === "rejected" && <span className="ml-2">Rejected</span>}
                          {s.currentStatus === "pending" && <span className="ml-2 status-pending">Pending</span>}
                          {!alreadyOnThisPosition && s.busyWith && (
                            <span className="ml-2 text-amber-700 font-medium">
                              Busy - {s.busyWith.clientName} ({s.busyWith.eventDate}) as {s.busyWith.role}
                            </span>
                          )}
                          {alreadyOnThisPosition && s.busyWith && (
                            <span className="ml-2 text-red-600 font-medium">
                              ⚠ Also invited as {s.busyWith.role} - remove one
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Extras row: Travel and each company add-on render the
                          same way — checkbox, then a $ input that only shows
                          once the checkbox is ticked. Shown only when the
                          staff is actually invited. */}
                      {checked && (
                        <div className="flex items-center gap-3 flex-wrap text-xs">
                          <ExtraChip
                            label="Travel"
                            checked={tChecked}
                            amount={travelRates[s.userId] ?? ""}
                            onToggle={(on) => {
                              setTravelChecked((prev) => ({ ...prev, [s.userId]: on }));
                              if (!on) setTravelRates((prev) => ({ ...prev, [s.userId]: "" }));
                            }}
                            onAmountChange={(v) => setTravelRates((prev) => ({ ...prev, [s.userId]: v }))}
                          />
                          {companyAddOns.map((a) => {
                            const on = assignedAddOns.has(a.id);
                            const amt = on ? (assignedAddOns.get(a.id) ?? "") : "";
                            return (
                              <ExtraChip
                                key={a.id}
                                label={a.name}
                                checked={on}
                                amount={amt}
                                onToggle={(next) => {
                                  setAddOnAssignments((prev) => {
                                    const m = new Map(prev[s.userId] ?? []);
                                    if (next) m.set(a.id, m.get(a.id) ?? "");
                                    else m.delete(a.id);
                                    return { ...prev, [s.userId]: m };
                                  });
                                }}
                                onAmountChange={(v) => {
                                  setAddOnAssignments((prev) => {
                                    const m = new Map(prev[s.userId] ?? []);
                                    m.set(a.id, v);
                                    return { ...prev, [s.userId]: m };
                                  });
                                }}
                              />
                            );
                          })}
                        </div>
                      )}

                      <select
                        value={checked ? String(tier) : ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelections((prev) => ({
                            ...prev,
                            [s.userId]: v === "" ? null : Number(v),
                          }));
                        }}
                        className="input !w-auto !py-1 text-xs shrink-0 ml-auto"
                      >
                        <option value="">Not invited</option>
                        {TIER_LABELS.map((label, i) => (
                          <option key={i} value={i}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </label>
                );
              })
            )}
          </div>

        </div>
      )}
    </div>
  );
}

function CityPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2 py-1 text-xs rounded-full border ${active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-300 hover:border-gray-500"}`}>
      {label}
    </button>
  );
}

/**
 * Uniform checkbox + conditional $ input used for Travel and every company
 * add-on. Ticking the box reveals a tiny dollar input that the manager types
 * a per-person amount into. Clicks are stopPropagation'd so ticking here
 * doesn't toggle the outer staff-row label.
 */
function ExtraChip({
  label,
  checked,
  amount,
  onToggle,
  onAmountChange,
}: {
  label: string;
  checked: boolean;
  amount: string;
  onToggle: (on: boolean) => void;
  onAmountChange: (v: string) => void;
}) {
  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        className="w-3.5 h-3.5"
      />
      <span className="text-gray-700">{label}</span>
      {checked && (
        <>
          <span className="text-gray-500">$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.target.select()}
            placeholder="0"
            className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs outline-none focus:border-gray-500"
          />
        </>
      )}
    </span>
  );
}
