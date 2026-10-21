"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hidden timezone input that the browser auto-fills from
 * Intl.DateTimeFormat().resolvedOptions().timeZone on mount. Shows the
 * detected tz to the user so they can confirm it's right. Falls back
 * to the stored value if detection fails.
 */
export function TimezoneField({ initialTz, name = "timezone" }: { initialTz: string | null; name?: string }) {
  const [tz, setTz] = useState<string>(initialTz ?? "");
  const detectedRef = useRef(false);

  useEffect(() => {
    if (detectedRef.current) return;
    detectedRef.current = true;
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTz(detected);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div>
      <label className="label">Timezone</label>
      <div className="input bg-gray-50 cursor-not-allowed flex items-center justify-between">
        <span>{tz || <em className="text-gray-400">Detecting…</em>}</span>
        <span className="text-xs text-gray-500">Auto-detected</span>
      </div>
      <input type="hidden" name={name} value={tz} />
      <p className="text-xs text-gray-500 mt-1">
        Used so your shift reminders fire at the right local hour. Updates to match whatever device
        you&apos;re on when you save your profile.
      </p>
    </div>
  );
}
