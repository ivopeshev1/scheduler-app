"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tiny client component that detects the browser's timezone on mount
 * and writes it into a hidden input + shows a one-liner so the user
 * sees what timezone the window will apply to. Falls back to the
 * stored value if detection fails.
 */
export function QuietHoursTzField({ initialTz }: { initialTz: string | null }) {
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
    <>
      <input type="hidden" name="quietHoursTz" value={tz} />
      <p className="text-xs text-gray-500">
        Times are interpreted in your local timezone
        {tz ? <> (<strong>{tz}</strong>)</> : ""}.
        {!tz && initialTz ? <> Currently saved as <strong>{initialTz}</strong>.</> : null}
      </p>
    </>
  );
}
