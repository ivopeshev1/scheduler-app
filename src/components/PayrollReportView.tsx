"use client";

import { useRef, useState } from "react";

export type ReportShift = {
  date: string; // MM/DD/YYYY
  shortDate: string; // e.g. "Oct 3"
  event: string;
  role: string;
  rate: number;
  rateType: "flat" | "hourly";
  hours: number;
  earning: number;
  addOns: Array<{ name: string; amount: number }>;
  travel: number;
  gratuity: number;
  total: number;
  paid: boolean;
};

export type ReportStaff = {
  name: string;
  shifts: ReportShift[];
  staffTotal: number;
  allPaid: boolean;
};

/**
 * Printable + copyable payroll report. Lives on the Payroll tab and
 * mirrors the editable table above it. The report body is a
 * fixed-width monospaced block the manager can select, copy, or print.
 */
export function PayrollReportView({
  periodLabel,
  filterLabel,
  staff,
}: {
  periodLabel: string;
  filterLabel: string;
  staff: ReportStaff[];
}) {
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLPreElement>(null);

  const text = buildReportText(staff, periodLabel, filterLabel);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select the <pre> contents so the user can Cmd+C.
      if (bodyRef.current) {
        const range = document.createRange();
        range.selectNodeContents(bodyRef.current);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  function print() {
    window.print();
  }

  if (staff.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center text-gray-500">
        No shifts in this pay period to report.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2 mb-3 print:hidden">
        <button type="button" onClick={copy} className="btn btn-secondary text-sm">
          {copied ? "Copied ✓" : "Copy report"}
        </button>
        <button type="button" onClick={print} className="btn btn-secondary text-sm">
          Print
        </button>
      </div>
      <pre
        ref={bodyRef}
        className="font-mono text-xs leading-5 whitespace-pre overflow-x-auto bg-white border rounded-lg p-5 print:border-0 print:p-0"
      >
        {text}
      </pre>
    </>
  );
}

// ---------- helpers ---------------------------------------------------------

/**
 * Build the fixed-width payroll report body - the same text the user
 * sees on screen and gets when they click Copy / Print.
 */
function buildReportText(staff: ReportStaff[], periodLabel: string, filterLabel: string): string {
  const header = `Pay period: ${periodLabel}     [filter: ${filterLabel}]`;
  const divider = "─".repeat(Math.max(header.length, 60));
  const lines: string[] = [header, divider, ""];
  // Determine column widths dynamically so events + roles align.
  const dateW = 7; // "Oct 10 "
  const allShifts = staff.flatMap((s) => s.shifts);
  const eventW = Math.max(8, ...allShifts.map((s) => s.event.length)) + 2;
  const roleW = Math.max(5, ...allShifts.map((s) => s.role.length)) + 2;
  for (const person of staff) {
    const paidMarker = person.allPaid ? " (fully paid ✓)" : "";
    lines.push(`${person.name} · ${person.shifts.length} shift${person.shifts.length === 1 ? "" : "s"}${paidMarker}`);
    for (const s of person.shifts) {
      const left = ` ${pad(s.shortDate, dateW)}${pad(s.event, eventW)}${pad(s.role, roleW)}`;
      const calc =
        s.rateType === "flat"
          ? `$${s.rate} flat = $${s.total.toFixed(2)}`
          : `${s.hours.toFixed(1)}h × $${s.rate} = $${s.total.toFixed(2)}`;
      lines.push(`${left}${calc}`);
      if (s.addOns.length > 0 || s.travel > 0 || s.gratuity > 0) {
        const extras: string[] = [];
        for (const a of s.addOns) extras.push(`${a.name} $${a.amount}`);
        if (s.travel > 0) extras.push(`travel $${s.travel}`);
        if (s.gratuity > 0) extras.push(`gratuity $${s.gratuity}`);
        lines.push(`${" ".repeat(1 + dateW + eventW + roleW)}+ ${extras.join(", ")}`);
      }
    }
    const bulkTag = person.allPaid ? "" : "  [Mark all paid ▸]";
    const totalLine = `${" ".repeat(1 + dateW + eventW + roleW)}Total: $${person.staffTotal.toFixed(2)}${bulkTag}`;
    lines.push(totalLine);
    lines.push("");
  }
  return lines.join("\n");
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s + " ";
  return s + " ".repeat(width - s.length);
}
