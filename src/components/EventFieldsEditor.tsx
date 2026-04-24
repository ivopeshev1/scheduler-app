"use client";

import { useState, useTransition } from "react";
import type { FieldBucket } from "@/lib/event-fields";

export type FieldRow = {
  fieldKey: string;
  label: string;
  enabled: boolean;
  required: boolean;
  shareWithStaff: boolean;
  notifyOnChange: boolean;
  isCustom: boolean;
  bucket: FieldBucket; // "required" | "optional" | "suggested" | (for custom fields, always "optional")
  lockedEnabled?: boolean;
  lockedRequired?: boolean;
};

type SavePayload = {
  rows: Array<{
    fieldKey: string;
    label: string;
    enabled: boolean;
    required: boolean;
    shareWithStaff: boolean;
    notifyOnChange: boolean;
    isCustom: boolean;
  }>;
  deletions: string[]; // custom field keys to delete
};

/**
 * Settings → Event fields editor. Renders three buckets (Required, Optional,
 * Suggested) plus any custom fields the owner has added. Each row has four
 * toggles: Enabled, Required, Share with staff, Notify staff on change. The
 * last two are contingent — Notify is only tickable when Share is on.
 */
export function EventFieldsEditor({
  initialRows,
  onSave,
  onAddCustom,
}: {
  initialRows: FieldRow[];
  onSave: (payload: SavePayload) => Promise<void>;
  onAddCustom: (label: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<FieldRow[]>(initialRows);
  const [deletions, setDeletions] = useState<string[]>([]);
  const [newCustomLabel, setNewCustomLabel] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [, startTransition] = useTransition();

  function patch(fieldKey: string, changes: Partial<FieldRow>) {
    setRows((prev) => prev.map((r) => {
      if (r.fieldKey !== fieldKey) return r;
      const next = { ...r, ...changes };
      // If share_with_staff is turned off, force notify_on_change off too.
      if (next.shareWithStaff === false) next.notifyOnChange = false;
      // If the field is disabled, required/share/notify all reset to false.
      if (next.enabled === false && !next.lockedEnabled) {
        next.required = false;
        next.shareWithStaff = false;
        next.notifyOnChange = false;
      }
      return next;
    }));
    setSaved("idle");
  }

  function deleteCustom(fieldKey: string) {
    setRows((prev) => prev.filter((r) => r.fieldKey !== fieldKey));
    setDeletions((prev) => [...prev, fieldKey]);
    setSaved("idle");
  }

  function save() {
    setSaved("saving");
    startTransition(async () => {
      await onSave({
        rows: rows.map((r) => ({
          fieldKey: r.fieldKey,
          label: r.label,
          enabled: r.enabled,
          required: r.required,
          shareWithStaff: r.shareWithStaff,
          notifyOnChange: r.notifyOnChange,
          isCustom: r.isCustom,
        })),
        deletions,
      });
      setDeletions([]);
      setSaved("saved");
    });
  }

  async function addCustom() {
    const label = newCustomLabel.trim();
    if (!label) return;
    await onAddCustom(label);
    setNewCustomLabel("");
  }

  const required = rows.filter((r) => r.bucket === "required" && !r.isCustom);
  const optional = rows.filter((r) => r.bucket === "optional" && !r.isCustom);
  const suggested = rows.filter((r) => r.bucket === "suggested" && !r.isCustom);
  const custom = rows.filter((r) => r.isCustom);

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">
        <strong className="text-gray-700">Share with staff</strong> includes the field in invite emails.{" "}
        <strong className="text-gray-700">Notify on change</strong> triggers an update email if this field is edited after sending;
        only available when Share is on.
      </p>

      <Section title="Required" subtitle="Always shown and required on the event setup page.">
        {required.map((r) => <FieldRowView key={r.fieldKey} row={r} onPatch={patch} />)}
      </Section>

      <Section title="Optional presets" subtitle="Shown by default; toggle off to hide.">
        {optional.map((r) => <FieldRowView key={r.fieldKey} row={r} onPatch={patch} />)}
      </Section>

      <Section title="Suggested" subtitle="Off by default. Turn on whichever apply to your business.">
        {suggested.map((r) => <FieldRowView key={r.fieldKey} row={r} onPatch={patch} />)}
      </Section>

      {custom.length > 0 && (
        <Section title="Custom fields" subtitle="Free-form fields you added.">
          {custom.map((r) => (
            <FieldRowView key={r.fieldKey} row={r} onPatch={patch} onDelete={() => deleteCustom(r.fieldKey)} />
          ))}
        </Section>
      )}

      <div className="border-t pt-4 space-y-2">
        <label className="label text-sm">Add a custom field</label>
        <div className="flex items-stretch gap-2">
          <input
            type="text"
            value={newCustomLabel}
            onChange={(e) => setNewCustomLabel(e.target.value)}
            placeholder="e.g. Dress code, Parking instructions, Contract #"
            maxLength={60}
            className="input flex-1"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!newCustomLabel.trim()}
            className="btn btn-secondary whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add field
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Custom fields are free text. They save immediately on Add; toggle their options in the list above.
        </p>
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <button type="button" onClick={save} disabled={saved === "saving"} className="btn btn-primary">
          {saved === "saving" ? "Saving…" : "Save event fields"}
        </button>
        {saved === "saved" && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">{title}</h3>
      <p className="text-xs text-gray-500 mb-2">{subtitle}</p>
      <div className="border rounded-lg bg-white divide-y">{children}</div>
    </section>
  );
}

function FieldRowView({
  row,
  onPatch,
  onDelete,
}: {
  row: FieldRow;
  onPatch: (fieldKey: string, changes: Partial<FieldRow>) => void;
  onDelete?: () => void;
}) {
  const notifyDisabled = !row.shareWithStaff;
  const togglesDisabled = !row.enabled;
  return (
    <div className="flex items-center gap-4 px-3 py-2.5 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <div className="text-sm font-medium">{row.label}</div>
      </div>
      <div className="flex items-center gap-4 text-xs flex-wrap">
        <Toggle
          label="Enabled"
          checked={row.enabled}
          disabled={row.lockedEnabled}
          onChange={(v) => onPatch(row.fieldKey, { enabled: v })}
        />
        <Toggle
          label="Required"
          checked={row.required}
          disabled={row.lockedRequired || togglesDisabled}
          onChange={(v) => onPatch(row.fieldKey, { required: v })}
        />
        <Toggle
          label="Share with staff"
          checked={row.shareWithStaff}
          disabled={togglesDisabled}
          onChange={(v) => onPatch(row.fieldKey, { shareWithStaff: v })}
        />
        <Toggle
          label="Notify on change"
          checked={row.notifyOnChange}
          disabled={togglesDisabled || notifyDisabled}
          onChange={(v) => onPatch(row.fieldKey, { notifyOnChange: v })}
        />
        {onDelete && (
          <button type="button" onClick={onDelete} className="text-red-600 hover:underline">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`inline-flex items-center gap-1.5 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5"
      />
      <span>{label}</span>
    </label>
  );
}
