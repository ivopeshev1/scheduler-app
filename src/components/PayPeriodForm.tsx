"use client";

import { useState } from "react";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

/**
 * Settings → Pay period form. UI exposes cadence + a start-day picker
 * that adapts to cadence: day-of-week for weekly / biweekly, day-of-
 * month for monthly. Server derives the real anchor date from these
 * inputs so the manager never has to think about dates.
 */
export function PayPeriodForm({
  action,
  initialCadence,
  initialAnchor,
}: {
  action: (formData: FormData) => Promise<void>;
  initialCadence: "weekly" | "biweekly" | "monthly";
  initialAnchor: string | null;
}) {
  const [cadence, setCadence] = useState<"weekly" | "biweekly" | "monthly">(initialCadence);

  // Derive the default day-of-week / day-of-month from the stored
  // anchor so the dropdowns pre-select the manager's previous choice.
  function dowFromAnchor(a: string | null): number {
    if (!a) return 1; // default Monday
    const d = new Date(a + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? 1 : d.getUTCDay();
  }
  function domFromAnchor(a: string | null): number {
    if (!a) return 1; // default 1st
    const d = new Date(a + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? 1 : d.getUTCDate();
  }
  const defaultDow = dowFromAnchor(initialAnchor);
  const defaultDom = domFromAnchor(initialAnchor);

  return (
    <form action={action} className="grid md:grid-cols-2 gap-4 max-w-xl">
      <div>
        <label className="label" htmlFor="payPeriodCadence">Cadence</label>
        <select
          id="payPeriodCadence"
          name="payPeriodCadence"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as "weekly" | "biweekly" | "monthly")}
          className="input"
        >
          <option value="weekly">Weekly</option>
          <option value="biweekly">Bi-weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      {cadence !== "monthly" ? (
        <div>
          <label className="label" htmlFor="startDayOfWeek">Starts on</label>
          <select
            id="startDayOfWeek"
            name="startDayOfWeek"
            defaultValue={String(defaultDow)}
            className="input"
          >
            {WEEKDAYS.map((d) => (<option key={d.value} value={d.value}>{d.label}</option>))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            The day of the week each pay period begins.
          </p>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="startDayOfMonth">Starts on day</label>
          <select
            id="startDayOfMonth"
            name="startDayOfMonth"
            defaultValue={String(defaultDom)}
            className="input"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            The day of the month each pay period begins (e.g. 1 for the 1st).
          </p>
        </div>
      )}
      <div className="md:col-span-2">
        <button type="submit" className="btn btn-secondary">Save pay period</button>
      </div>
    </form>
  );
}
