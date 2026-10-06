"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { computeTotalHours } from "@/lib/pay-period";
import { formatMDY } from "@/lib/format-mdy";

/**
 * One editable row on the Payroll tab. Lets the manager type clock
 * in/out, break, and gratuity for a single shift. Everything saves on
 * blur. The row computes hours + earnings live so the manager can see
 * the dollar impact before committing. The Paid checkbox flips the
 * paid_at timestamp on the invitation.
 */
export function PayrollShiftRow({
  invitationId,
  date,
  eventName,
  role,
  rate,
  rateType,
  initialClockIn,
  initialClockOut,
  initialBreakFrom,
  initialBreakTo,
  initialGratuity,
  travel,
  addOns,
  paidAt,
  save,
  showAddOns,
  showTravel,
  showGratuity,
}: {
  invitationId: string;
  date: string;
  eventName: string;
  role: string;
  rate: number;
  rateType: "flat" | "hourly";
  initialClockIn: string | null;
  initialClockOut: string | null;
  initialBreakFrom: string | null;
  initialBreakTo: string | null;
  initialGratuity: number | null;
  travel: number;
  addOns: Array<{ name: string; amount: number }>;
  paidAt: string | null;
  save: (formData: FormData) => Promise<void>;
  showAddOns: boolean;
  showTravel: boolean;
  showGratuity: boolean;
}) {
  const router = useRouter();
  const [clockIn, setClockIn] = useState(initialClockIn ?? "");
  const [clockOut, setClockOut] = useState(initialClockOut ?? "");
  const [breakFrom, setBreakFrom] = useState(initialBreakFrom ?? "");
  const [breakTo, setBreakTo] = useState(initialBreakTo ?? "");
  const [gratuity, setGratuity] = useState(initialGratuity != null ? String(initialGratuity) : "");
  const [savedPaidAt, setSavedPaidAt] = useState(paidAt);
  const [pending, startTransition] = useTransition();

  const hours = useMemo(
    () => (rateType === "flat" ? 0 : computeTotalHours(clockIn, clockOut, breakFrom, breakTo)),
    [clockIn, clockOut, breakFrom, breakTo, rateType],
  );
  const baseEarning = rateType === "flat" ? rate : rate * hours;
  const addOnTotal = addOns.reduce((s, a) => s + (a.amount ?? 0), 0);
  const gratuityNum = Number(gratuity);
  const gratuityNumSafe = Number.isFinite(gratuityNum) ? gratuityNum : 0;
  const total = baseEarning + addOnTotal + travel + gratuityNumSafe;

  function persist(togglePaid?: "on" | "off") {
    const fd = new FormData();
    fd.set("invitationId", invitationId);
    fd.set("clockIn", clockIn);
    fd.set("clockOut", clockOut);
    fd.set("breakFrom", breakFrom);
    fd.set("breakTo", breakTo);
    fd.set("gratuity", gratuity);
    if (togglePaid) fd.set("togglePaid", togglePaid);
    startTransition(async () => {
      await save(fd);
      router.refresh();
    });
  }

  function togglePaid() {
    const next = savedPaidAt ? null : new Date().toISOString();
    setSavedPaidAt(next);
    persist(next ? "on" : "off");
  }

  const flatCellClass = "px-3 py-2 border-b";
  const timeInput = (val: string, setter: (v: string) => void, disabled = false) => (
    <input
      type="time"
      value={val}
      disabled={disabled}
      onChange={(e) => setter(e.target.value)}
      onBlur={() => persist()}
      className="input text-xs px-1 py-0.5 w-24 disabled:bg-gray-100 disabled:text-gray-400"
    />
  );

  return (
    <tr className={savedPaidAt ? "bg-green-50/60" : ""}>
      <td className={flatCellClass}>{formatMDY(date)}</td>
      <td className={flatCellClass}>
        <div className="flex flex-col leading-tight">
          <span className="font-medium">{eventName}</span>
          <span className="text-gray-600">{role}</span>
          <span className="text-gray-500">${rate}{rateType === "hourly" ? "/hr" : " flat"}</span>
        </div>
      </td>
      <td className={flatCellClass}>{timeInput(clockIn, setClockIn, rateType === "flat")}</td>
      <td className={flatCellClass}>{timeInput(clockOut, setClockOut, rateType === "flat")}</td>
      <td className={flatCellClass}>{timeInput(breakFrom, setBreakFrom, rateType === "flat")}</td>
      <td className={flatCellClass}>{timeInput(breakTo, setBreakTo, rateType === "flat")}</td>
      <td className={flatCellClass}>
        {rateType === "flat" ? <span className="text-gray-400">-</span> : hours.toFixed(2)}
      </td>
      <td className={flatCellClass}>
        <div className="flex flex-col leading-tight">
          <span>${baseEarning.toFixed(2)}</span>
          {rateType === "flat" && (
            <span className="text-[10px] uppercase tracking-wide text-gray-400">day rate</span>
          )}
        </div>
      </td>
      {showAddOns && (
        <td className={flatCellClass}>
          {addOns.length === 0 ? (
            <span className="text-gray-400">-</span>
          ) : (
            <div className="flex flex-col leading-tight">
              {addOns.map((a, i) => (
                <span key={i} className="whitespace-nowrap">
                  {a.name} <span className="text-gray-500">${a.amount}</span>
                </span>
              ))}
            </div>
          )}
        </td>
      )}
      {showTravel && (
        <td className={flatCellClass}>{travel > 0 ? `$${travel}` : <span className="text-gray-400">-</span>}</td>
      )}
      {showGratuity && (
        <td className={flatCellClass}>
          <input
            type="text"
            inputMode="decimal"
            value={gratuity}
            onChange={(e) => {
              // Allow digits + a single decimal point only
              const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
              setGratuity(v);
            }}
            onBlur={() => persist()}
            placeholder="0"
            className="text-xs px-1.5 py-0.5 w-14 border border-gray-300 rounded outline-none focus:border-gray-500"
          />
        </td>
      )}
      <td className={`${flatCellClass} font-semibold`}>${total.toFixed(2)}</td>
      <td className={flatCellClass}>
        <button
          type="button"
          onClick={togglePaid}
          disabled={pending}
          role="switch"
          aria-checked={!!savedPaidAt}
          className={`inline-flex items-center gap-2 group`}
          title={savedPaidAt ? "Click to mark unpaid" : "Click to mark paid"}
        >
          <span
            className={`relative inline-block w-9 h-5 rounded-full transition-colors ${
              savedPaidAt ? "bg-green-500" : "bg-gray-300"
            } ${pending ? "opacity-60" : ""}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                savedPaidAt ? "translate-x-4" : ""
              }`}
            />
          </span>
          <span className={savedPaidAt ? "text-green-700 text-xs font-semibold" : "text-gray-500 text-xs"}>
            {savedPaidAt ? "Paid" : "Unpaid"}
          </span>
        </button>
      </td>
    </tr>
  );
}
