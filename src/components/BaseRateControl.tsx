"use client";

import { useEffect, useRef, useState } from "react";

export type BaseRateMode = "standard" | "flat" | "hourly";

/**
 * Single-cell base rate selector. Shows a dropdown with three mutually-exclusive
 * options - Standard (uses the invitee's onboarded rate), Flat, or Hourly. The
 * Flat and Hourly options contain an inline $ input. Selecting an option (or
 * typing into its input) closes the dropdown and the trigger collapses back to
 * a one-line summary so the row height doesn't change.
 *
 * Writes two hidden form inputs so a classic <form action=...> server action
 * can read both the mode and the amount.
 */
export function BaseRateControl({
  baseRateFieldName,
  baseRateModeFieldName,
  defaultMode,
  defaultAmount,
}: {
  baseRateFieldName: string;
  baseRateModeFieldName: string;
  defaultMode: BaseRateMode;
  defaultAmount: number | string;
}) {
  const [mode, setMode] = useState<BaseRateMode>(defaultMode);
  const [amount, setAmount] = useState<string>(defaultAmount === 0 || defaultAmount === "0" ? "" : String(defaultAmount ?? ""));
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the control.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Compact one-line label for the collapsed trigger
  const label =
    mode === "standard"
      ? "Standard"
      : mode === "flat"
      ? amount ? `Flat: $${amount}` : "Flat: $…"
      : amount ? `Hourly: $${amount}/hr` : "Hourly: $…/hr";

  // In Standard mode the amount is intentionally blank - the backend will
  // derive each invitee's rate from their profile.
  const submittedAmount = mode === "standard" ? "" : amount;

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={baseRateModeFieldName} value={mode} />
      <input type="hidden" name={baseRateFieldName} value={submittedAmount} />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input text-left flex items-center justify-between w-full"
      >
        <span className="truncate">{label}</span>
        <span className="text-gray-400 ml-1">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 min-w-[220px] bg-white border border-gray-300 rounded-md shadow-lg p-1">
          {/* Standard - just a clickable row */}
          <button
            type="button"
            onClick={() => {
              setMode("standard");
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 flex items-center gap-2 ${
              mode === "standard" ? "bg-gray-50 font-medium" : ""
            }`}
          >
            <span className="w-3 inline-block">{mode === "standard" ? "•" : ""}</span>
            Standard <span className="text-xs text-gray-500">(onboarded rate)</span>
          </button>

          {/* Flat - click focuses the $ input and selects the mode */}
          <div
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-gray-100 cursor-pointer ${
              mode === "flat" ? "bg-gray-50 font-medium" : ""
            }`}
            onClick={() => setMode("flat")}
          >
            <span className="w-3 inline-block">{mode === "flat" ? "•" : ""}</span>
            <span>Flat</span>
            <span className="text-gray-500">$</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={mode === "flat" ? amount : ""}
              placeholder="0"
              onFocus={() => setMode("flat")}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              className="flex-1 min-w-0 w-20 border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:border-gray-500"
            />
          </div>

          {/* Hourly - same pattern */}
          <div
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-gray-100 cursor-pointer ${
              mode === "hourly" ? "bg-gray-50 font-medium" : ""
            }`}
            onClick={() => setMode("hourly")}
          >
            <span className="w-3 inline-block">{mode === "hourly" ? "•" : ""}</span>
            <span>Hourly</span>
            <span className="text-gray-500">$</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={mode === "hourly" ? amount : ""}
              placeholder="0"
              onFocus={() => setMode("hourly")}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
              className="flex-1 min-w-0 w-20 border border-gray-300 rounded px-2 py-1 text-sm outline-none focus:border-gray-500"
            />
            <span className="text-gray-500 text-xs">/hr</span>
          </div>
        </div>
      )}
    </div>
  );
}
