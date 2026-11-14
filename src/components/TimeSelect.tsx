"use client";

import { useEffect, useState } from "react";

/**
 * Hour / minute / AM-PM picker that starts on PM, so evening shifts need
 * fewer clicks than the browser's built-in time box.
 *
 * Value format is the same as <input type="time">: "HH:MM" in 24-hour time,
 * or "" when no hour is picked. Use `name` to post it with a form (a hidden
 * input carries the value) and/or `onChange` to read it from a parent.
 */
export function TimeSelect({
  name,
  id,
  defaultValue,
  value,
  onChange,
  required,
  compact,
}: {
  name?: string;
  id?: string;
  defaultValue?: string | null;
  value?: string | null;
  onChange?: (v: string) => void;
  required?: boolean;
  compact?: boolean;
}) {
  const initial = parse(value ?? defaultValue ?? "");
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [ampm, setAmpm] = useState(initial.ampm);

  // A parent clearing the value (e.g. "Current event times") resets the picker.
  useEffect(() => {
    if (value === "" || value === null) {
      setHour("");
      setMinute("00");
      setAmpm("PM");
    }
  }, [value]);

  const out = toValue(hour, minute, ampm);

  function update(h: string, m: string, a: "AM" | "PM") {
    setHour(h);
    setMinute(m);
    setAmpm(a);
    onChange?.(toValue(h, m, a));
  }

  const minuteOptions = ["00", "15", "30", "45"];
  if (!minuteOptions.includes(minute)) minuteOptions.push(minute);
  minuteOptions.sort();

  const sel = `border border-gray-300 rounded bg-white outline-none focus:border-gray-500 ${compact ? "px-1 py-1 text-sm" : "px-2 py-2"}`;

  return (
    <div className="flex items-center gap-1">
      {name && <input type="hidden" name={name} value={out} />}
      <select
        id={id}
        aria-label="Hour"
        value={hour}
        required={required}
        onChange={(e) => update(e.target.value, minute, ampm)}
        className={sel}
      >
        <option value="">--</option>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-gray-500">:</span>
      <select
        aria-label="Minute"
        value={minute}
        onChange={(e) => update(hour, e.target.value, ampm)}
        className={sel}
      >
        {minuteOptions.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select
        aria-label="AM or PM"
        value={ampm}
        onChange={(e) => update(hour, minute, e.target.value as "AM" | "PM")}
        className={sel}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

function parse(v: string): { hour: string; minute: string; ampm: "AM" | "PM" } {
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m) return { hour: "", minute: "00", ampm: "PM" };
  const h24 = Number(m[1]);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour: String(h12), minute: m[2], ampm };
}

function toValue(hour: string, minute: string, ampm: "AM" | "PM"): string {
  if (!hour) return "";
  let h = Number(hour) % 12;
  if (ampm === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
}
