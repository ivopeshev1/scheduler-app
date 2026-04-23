"use client";

import { useState, useTransition } from "react";
import type { NotificationSettings, Channels, LeadTime } from "@/lib/notification-settings";

/**
 * Settings → Notifications editor. Holds the entire settings object in local
 * React state + auto-expire days as a sibling number, submits the whole blob
 * to the server action on Save.
 *
 * "At least one channel" invariant: rows that require at least one checkbox
 * will auto-re-check the other channel if the user unchecks the last one, so
 * the user never ends up in an invalid state that blocks Save.
 */
export function NotificationsEditor({
  initialSettings,
  initialAutoExpireDays,
  onSave,
}: {
  initialSettings: NotificationSettings;
  initialAutoExpireDays: number | null;
  onSave: (payload: { settings: NotificationSettings; autoExpireDays: number | null }) => Promise<void>;
}) {
  const [settings, setSettings] = useState<NotificationSettings>(initialSettings);
  const [autoExpireDays, setAutoExpireDays] = useState<string>(
    initialAutoExpireDays == null ? "" : String(initialAutoExpireDays)
  );
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // Generic updater that replaces the channels part of any key under
  // settings.staff or settings.manager. Respects the "at least one" rule
  // if requireOne is true - toggling off the last checked channel flips the
  // other one back on.
  function updateChannels(
    scope: "staff" | "manager",
    key: string,
    patch: Partial<Channels>,
    requireOne: boolean,
  ) {
    setSettings((prev) => {
      const current = (prev[scope] as Record<string, any>)[key];
      let next = { ...current, ...patch };
      if (requireOne && !next.email && !next.text) {
        // Flipping off the just-unchecked one - flip the other back on so the
        // invariant holds without blocking the user.
        if ("email" in patch) next.text = true;
        else if ("text" in patch) next.email = true;
      }
      return {
        ...prev,
        [scope]: { ...prev[scope], [key]: next },
      };
    });
    setSaved(false);
  }

  function updateExtra<T extends object>(
    scope: "staff" | "manager",
    key: string,
    patch: T,
  ) {
    setSettings((prev) => {
      const current = (prev[scope] as Record<string, any>)[key];
      return {
        ...prev,
        [scope]: { ...prev[scope], [key]: { ...current, ...patch } },
      };
    });
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      const days = autoExpireDays.trim() === "" ? null : Math.max(1, Math.min(60, Math.floor(Number(autoExpireDays))));
      await onSave({
        settings,
        autoExpireDays: Number.isFinite(days) ? (days as number | null) : null,
      });
      setSaved(true);
    });
  }

  return (
    <div className="space-y-8">
      <p className="text-xs text-gray-500">
        Text-message delivery isn&apos;t hooked up yet - text preferences save but won&apos;t send until an SMS
        provider is wired in. Email works today.
      </p>

      {/* ----------------- Notifications to staff ----------------- */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">To staff</h3>
        <div className="border rounded-lg bg-white divide-y">
          <Row
            title="Invitation to sign up / onboard"
            description="Sent once when a staff member is added and first receives their login link."
            channels={settings.staff.onboardInvite}
            requireOne
            onChange={(p) => updateChannels("staff", "onboardInvite", p, true)}
          />

          <Row
            title="Reminders that onboarding isn't finished"
            description="Follow-ups sent to staff who haven't completed onboarding, whether or not they've accepted the invite."
            channels={settings.staff.onboardReminder}
            requireOne
            onChange={(p) => updateChannels("staff", "onboardReminder", p, true)}
          >
            <LabeledControl label="Frequency">
              <select
                value={String(settings.staff.onboardReminder.frequencyHours)}
                onChange={(e) => updateExtra("staff", "onboardReminder", {
                  frequencyHours: Number(e.target.value) as 12 | 24 | 48,
                })}
                className="input text-sm py-1"
              >
                <option value="12">Every 12 hours</option>
                <option value="24">Every 1 day</option>
                <option value="48">Every 2 days</option>
              </select>
            </LabeledControl>
          </Row>

          <Row
            title="Max onboarding reminders"
            description="After this many reminders go unanswered, we stop pinging. The invitation stays open so they can still accept."
            channels={settings.staff.onboardMaxReminders}
            requireOne
            onChange={(p) => updateChannels("staff", "onboardMaxReminders", p, true)}
          >
            <LabeledControl label="Max reminders">
              <input
                type="number"
                min={0}
                max={50}
                value={settings.staff.onboardMaxReminders.count === 0 ? "" : settings.staff.onboardMaxReminders.count}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = raw === "" ? 0 : Math.floor(Number(raw));
                  updateExtra("staff", "onboardMaxReminders", {
                    count: Number.isFinite(n) && n >= 0 ? Math.min(50, n) : 0,
                  });
                }}
                className="input text-sm py-1 w-20"
              />
            </LabeledControl>
          </Row>

          <Row
            title="Invited to a shift"
            description="The primary invite email/text that goes out when a manager picks a staff member for a shift."
            channels={settings.staff.shiftInvite}
            requireOne
            onChange={(p) => updateChannels("staff", "shiftInvite", p, true)}
          />

          <Row
            title="Event cancelled"
            description="Sent when a shift the staff has been invited to (or accepted) is cancelled."
            channels={settings.staff.eventCancelled}
            requireOne
            onChange={(p) => updateChannels("staff", "eventCancelled", p, true)}
          />

          <Row
            title="Event modified"
            description="Sent when a shift the staff has been invited to (or accepted) has been modified and details have been changed (time, venue, rate, etc.)."
            channels={settings.staff.eventModified}
            requireOne
            onChange={(p) => updateChannels("staff", "eventModified", p, true)}
          />

          <Row
            title="Upcoming-shift reminders"
            description="Lead-time reminders before the shift starts. Add more if you want multiple nudges (e.g. 1 day AND 2 hours before)."
            channels={settings.staff.upcomingShift}
            requireOne
            onChange={(p) => updateChannels("staff", "upcomingShift", p, true)}
          >
            <LeadTimeList
              leadTimes={settings.staff.upcomingShift.leadTimes}
              onChange={(leadTimes) => updateExtra("staff", "upcomingShift", { leadTimes })}
            />
          </Row>

          <Row
            title="Awaiting response reminder"
            description="Nudges the invitee that their shift is about to be offered to other staff because they haven't responded yet. No notifications between 10pm and 8am."
            channels={settings.staff.openShiftReminder}
            requireOne
            onChange={(p) => updateChannels("staff", "openShiftReminder", p, true)}
          >
            <LabeledControl label="Frequency">
              <select
                value={String(settings.staff.openShiftReminder.frequencyHours)}
                onChange={(e) => updateExtra("staff", "openShiftReminder", {
                  frequencyHours: Number(e.target.value) as 12 | 24,
                })}
                className="input text-sm py-1"
              >
                <option value="12">Every 12 hours</option>
                <option value="24">Every 24 hours</option>
              </select>
            </LabeledControl>
          </Row>

          <Row
            title="Auto-expire notice"
            description="When a priority invite auto-expires because the staff hasn't responded in time, let them know. Others won't receive a new invite in their place, but the staff can still pick up the shift themselves if it's still open."
            channels={settings.staff.autoExpire}
            requireOne
            onChange={(p) => updateChannels("staff", "autoExpire", p, true)}
          >
            <LabeledControl label="Auto-expire after">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={autoExpireDays}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => { setAutoExpireDays(e.target.value); setSaved(false); }}
                  placeholder="-"
                  className="input text-sm py-1 w-20"
                />
                <span className="text-xs text-gray-600">days with no response (blank = disabled)</span>
              </div>
            </LabeledControl>
          </Row>
        </div>
      </section>

      {/* ----------------- Notifications to manager ----------------- */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">To the manager</h3>
        <div className="border rounded-lg bg-white divide-y">
          <Row
            title="Staff accepted onboarding"
            description="Fires when a newly-invited staff finishes setup."
            channels={settings.manager.staffAcceptedOnboard}
            onChange={(p) => updateChannels("manager", "staffAcceptedOnboard", p, false)}
          />

          <Row
            title="Staff declined onboarding"
            description="Fires when an invited staff explicitly declines the initial invite."
            channels={settings.manager.staffDeclinedOnboard}
            onChange={(p) => updateChannels("manager", "staffDeclinedOnboard", p, false)}
          />

          <Row
            title="Staff hasn't completed onboarding"
            description="Fires after the onboarding reminder cycle runs out (see max reminders above)."
            channels={settings.manager.staffNotCompletedOnboard}
            onChange={(p) => updateChannels("manager", "staffNotCompletedOnboard", p, false)}
          />

          <Row
            title="Staff accepted a shift"
            description="Fires when an invited staff confirms they can work a shift."
            channels={settings.manager.staffAcceptedShift}
            onChange={(p) => updateChannels("manager", "staffAcceptedShift", p, false)}
          />

          <Row
            title="Staff declined (or cancelled) a shift"
            description="Fires on reject AND on accept-then-cancel. High-signal - text recommended."
            channels={settings.manager.staffDeclinedShift}
            requireOne
            onChange={(p) => updateChannels("manager", "staffDeclinedShift", p, true)}
          />

          <Row
            title="Shifts that need attention"
            description="Alerts the manager about shifts approaching their date that are still open (no invite sent) or pending (nobody responded yet)."
            channels={settings.manager.attentionAlerts}
            requireOne
            onChange={(p) => updateChannels("manager", "attentionAlerts", p, true)}
          >
            <LeadTimeList
              leadTimes={settings.manager.attentionAlerts.leadTimes}
              onChange={(leadTimes) => updateExtra("manager", "attentionAlerts", { leadTimes })}
            />
          </Row>

          <Row
            title="Auto-expire summary"
            description="Fires when a priority invite expires automatically. The shift needs immediate attention."
            channels={settings.manager.autoExpire}
            onChange={(p) => updateChannels("manager", "autoExpire", p, false)}
          />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "Saving…" : "Save notification settings"}
        </button>
        {saved && !pending && (
          <span className="text-sm text-green-700">Saved.</span>
        )}
      </div>
    </div>
  );
}

/** One notification row with title/description + email/text checkboxes + optional extras. */
function Row({
  title,
  description,
  channels,
  requireOne,
  onChange,
  children,
}: {
  title: string;
  description: React.ReactNode;
  channels: Channels;
  requireOne?: boolean;
  onChange: (patch: Partial<Channels>) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 flex gap-6 items-start flex-wrap">
      <div className="flex-1 min-w-[260px]">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
        {requireOne && (
          <div className="text-[11px] text-gray-400 mt-1">At least one channel required.</div>
        )}
      </div>
      <div className="flex items-start gap-5 pt-0.5">
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={channels.email}
            onChange={(e) => onChange({ email: e.target.checked })}
            className="w-4 h-4"
          />
          <span>Email</span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={channels.text}
            onChange={(e) => onChange({ text: e.target.checked })}
            className="w-4 h-4"
          />
          <span>Text</span>
        </label>
      </div>
      {children && <div className="w-full pl-0 sm:pl-4">{children}</div>}
    </div>
  );
}

function LabeledControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      {children}
    </div>
  );
}

/** Dynamic list of lead times - { value, unit } pairs with add/remove. */
function LeadTimeList({
  leadTimes,
  onChange,
}: {
  leadTimes: LeadTime[];
  onChange: (next: LeadTime[]) => void;
}) {
  function setAt(idx: number, patch: Partial<LeadTime>) {
    onChange(leadTimes.map((lt, i) => (i === idx ? { ...lt, ...patch } : lt)));
  }
  function remove(idx: number) {
    onChange(leadTimes.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...leadTimes, { value: 1, unit: "hours" }]);
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500 uppercase tracking-wide">Reminders</div>
      {leadTimes.length === 0 && (
        <div className="text-xs text-gray-400">No reminders configured. Add one below.</div>
      )}
      {leadTimes.map((lt, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            // value=0 renders as empty so the user can clear the field and
            // retype a multi-digit number. The send-time code will ignore any
            // entries that end up at 0.
            value={lt.value === 0 ? "" : lt.value}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const raw = e.target.value;
              const n = raw === "" ? 0 : Math.floor(Number(raw));
              setAt(idx, { value: Number.isFinite(n) && n >= 0 ? n : 0 });
            }}
            className="input text-sm py-1 w-20"
          />
          <select
            value={lt.unit}
            onChange={(e) => setAt(idx, { unit: e.target.value as LeadTime["unit"] })}
            className="input text-sm py-1"
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <span className="text-xs text-gray-500">before shift</span>
          <button
            type="button"
            onClick={() => remove(idx)}
            className="text-gray-400 hover:text-red-600 text-lg leading-none px-1"
            aria-label="Remove this reminder"
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-sm text-gray-600 hover:text-black underline"
      >
        + Add another reminder
      </button>
    </div>
  );
}
