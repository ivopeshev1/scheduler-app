"use client";

import { useState, useTransition } from "react";
import type { NotificationSettings } from "@/lib/notification-settings";

/**
 * Slim company-level notification settings card. Three company-wide knobs:
 *   - Urgent threshold hours - how close to an event an open position has
 *     to be before it counts as urgent (triggers the urgent-open-shifts
 *     alert).
 *   - Daily digest hour - what hour (local to the server) the digest
 *     batches get sent out at.
 *   - Priority invite auto-expire days - how long a priority invitee has
 *     to respond before the cascade promotes a backup.
 *
 * Per-user channel preferences (which notifications each manager wants,
 * email vs SMS, delivery mode) live under /manager/settings/me now, not
 * here. This card is only for things that affect everyone in the company.
 */
export function CompanyNotificationsCard({
  initialSettings,
  initialAutoExpireDays,
  onSave,
}: {
  initialSettings: NotificationSettings;
  initialAutoExpireDays: number | null;
  onSave: (payload: { settings: NotificationSettings; autoExpireDays: number | null }) => Promise<void>;
}) {
  const [threshold, setThreshold] = useState<12 | 24 | 48 | 72>(
    initialSettings.manager.urgentThresholdHours as 12 | 24 | 48 | 72
  );
  const [digestHour, setDigestHour] = useState<number>(initialSettings.manager.digestHourLocal);
  const [autoExpireDays, setAutoExpireDays] = useState<string>(
    initialAutoExpireDays == null ? "2" : String(initialAutoExpireDays)
  );
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setSaved(false);
    const days = Math.max(1, Math.min(60, Math.floor(Number(autoExpireDays) || 2)));
    const next: NotificationSettings = {
      ...initialSettings,
      manager: {
        ...initialSettings.manager,
        urgentThresholdHours: threshold,
        digestHourLocal: digestHour,
      },
    };
    startTransition(async () => {
      await onSave({ settings: next, autoExpireDays: days });
      setSaved(true);
    });
  }

  return (
    <section className="border rounded-lg bg-white p-6">
      <h2 className="font-semibold text-lg mb-1">Notifications (company-wide)</h2>
      <p className="text-sm text-gray-600 mb-5">
        Three settings that affect everyone in your company. Per-manager email / SMS /
        delivery choices live on each manager&apos;s own{" "}
        <strong>Settings</strong> page (avatar → My settings).
      </p>

      <div className="space-y-5">
        <div>
          <label htmlFor="urgentThreshold" className="label">Urgent threshold</label>
          <select
            id="urgentThreshold"
            className="input text-sm w-44"
            value={threshold}
            onChange={(e) => {
              setThreshold(Number(e.target.value) as 12 | 24 | 48 | 72);
              setSaved(false);
            }}
          >
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
            <option value={48}>48 hours (recommended)</option>
            <option value={72}>72 hours</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            An open position closer than this to the event triggers an urgent alert for every manager who gets Urgent / short-staffed notifications.
          </p>
        </div>

        <div>
          <label htmlFor="digestHour" className="label">Daily digest sent at</label>
          <select
            id="digestHour"
            className="input text-sm w-44"
            value={digestHour}
            onChange={(e) => {
              setDigestHour(Number(e.target.value));
              setSaved(false);
            }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            What hour the daily digest batch goes out at. Managers who&apos;ve set anything to <em>Summary</em>
            {" "}receive it then.
          </p>
        </div>

        <div>
          <label htmlFor="autoExpireDays" className="label">Priority invite auto-expire</label>
          <div className="flex items-center gap-2">
            <input
              id="autoExpireDays"
              type="number"
              min={1}
              max={60}
              step={1}
              value={autoExpireDays}
              onChange={(e) => { setAutoExpireDays(e.target.value); setSaved(false); }}
              className="input text-sm w-24"
            />
            <span className="text-sm text-gray-600">days</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            How long a priority invitee has to respond before the cascade promotes a backup (or alerts you if there isn&apos;t one). Company-level because the cascade&apos;s timing affects everyone.
          </p>
        </div>
      </div>

      {saved && (
        <div className="mt-5 border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
          Company-wide notification settings saved.
        </div>
      )}
      <div className="mt-5">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
