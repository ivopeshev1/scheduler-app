/**
 * Per-user notification preferences. The user chooses which of the
 * optional notifications they get on their Settings page; the result
 * is stored as a JSON map keyed by NotificationKey on users.notification_preferences.
 *
 * Rules:
 *  - A missing key falls back to DEFAULT_PREFS (true for everything).
 *  - Account-safety keys are flagged alwaysOn: true and ignore stored
 *    prefs entirely (password reset, suspension / restoration /
 *    removal). This is deliberate - a user who muted "account changes"
 *    shouldn't miss notice that they were suspended.
 *  - resolvePreferences() layers stored prefs on top of defaults and
 *    forces alwaysOn to true.
 */

export type NotificationKey =
  // Staff-facing
  | "shiftInvite" // You've been invited to a new shift
  | "shiftReminder" // Reminder day-before + morning-of
  | "beoSent" // BEO document sent / updated for your shift
  | "eventChanged" // Date / time / venue change on a shift you're on
  | "eventCancelled" // Manager cancelled the event
  | "paidReceipt" // You've been marked paid for a shift
  | "accountChange" // alwaysOn: your account was suspended / restored / removed
  | "passwordReset" // alwaysOn: forgot-password email
  // Manager-facing
  | "inviteResponse" // A staffer accepted or declined
  | "staffCancellation" // A staffer self-cancelled a confirmed shift
  | "dailyDigest" // Daily digest summary
  | "urgentOpenShifts" // Urgent-threshold alert for unfilled shifts
  | "backupNudge"; // Mid-window + last-call nudges for pending invites

export type NotificationChannelMeta = {
  key: NotificationKey;
  label: string;
  description: string;
  audience: "staff" | "manager";
  alwaysOn?: boolean;
};

export const NOTIFICATION_CHANNELS: readonly NotificationChannelMeta[] = [
  // Staff
  { key: "shiftInvite", label: "Shift invites", description: "A manager invited you to a new shift (priority or backup promotion).", audience: "staff" },
  { key: "shiftReminder", label: "Shift reminders", description: "Automatic reminder the day before + morning of each shift.", audience: "staff" },
  { key: "beoSent", label: "BEO sent / updated", description: "The manager sent or updated the BEO (banquet event order) for a shift you're on.", audience: "staff" },
  { key: "eventChanged", label: "Event changes", description: "The date, time, or venue of a shift you're on changed.", audience: "staff" },
  { key: "eventCancelled", label: "Event cancelled", description: "A shift you were confirmed for was cancelled by the manager.", audience: "staff" },
  { key: "paidReceipt", label: "Payment receipts", description: "You were marked paid for a shift.", audience: "staff" },
  { key: "accountChange", label: "Account changes", description: "Your account was suspended, restored, or removed. (Always on for security.)", audience: "staff", alwaysOn: true },
  { key: "passwordReset", label: "Password reset", description: "Forgot-password email. (Always on for security.)", audience: "staff", alwaysOn: true },
  // Manager
  { key: "inviteResponse", label: "Invite responses", description: "A staffer accepted or declined an invite you sent.", audience: "manager" },
  { key: "staffCancellation", label: "Staff cancellations", description: "A staffer self-cancelled a confirmed shift.", audience: "manager" },
  { key: "dailyDigest", label: "Daily digest", description: "End-of-day summary of changes and open shifts.", audience: "manager" },
  { key: "urgentOpenShifts", label: "Urgent open-shift alerts", description: "Alert when an open shift crosses the urgent threshold (near date, no coverage).", audience: "manager" },
  { key: "backupNudge", label: "Backup nudges", description: "Mid-window + last-call nudges to approve backup promotions on pending invites.", audience: "manager" },
] as const;

export type NotificationPrefs = Partial<Record<NotificationKey, boolean>>;

/** All optional notifications default to on. alwaysOn keys ignore the pref. */
export const DEFAULT_PREFS: Readonly<Record<NotificationKey, boolean>> = Object.freeze(
  Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c.key, true])) as Record<NotificationKey, boolean>,
);

/**
 * Does this user currently want to receive this notification?
 * Pass in whatever's stored on users.notification_preferences (may be
 * null, {}, or a partial map) and the key being checked.
 */
export function userWantsNotification(stored: unknown, key: NotificationKey): boolean {
  const meta = NOTIFICATION_CHANNELS.find((c) => c.key === key);
  if (meta?.alwaysOn) return true;
  if (!stored || typeof stored !== "object") return DEFAULT_PREFS[key];
  const v = (stored as Record<string, unknown>)[key];
  if (typeof v === "boolean") return v;
  return DEFAULT_PREFS[key];
}

/**
 * Merge stored prefs with defaults and force alwaysOn to true.
 * Useful for rendering the form with the right initial checkbox state.
 */
export function resolvePreferences(stored: unknown): Record<NotificationKey, boolean> {
  const out: Record<NotificationKey, boolean> = { ...DEFAULT_PREFS };
  for (const meta of NOTIFICATION_CHANNELS) {
    if (meta.alwaysOn) {
      out[meta.key] = true;
      continue;
    }
    if (stored && typeof stored === "object") {
      const v = (stored as Record<string, unknown>)[meta.key];
      if (typeof v === "boolean") out[meta.key] = v;
    }
  }
  return out;
}

/** Build a stored-shaped prefs object from a submitted form. */
export function prefsFromFormData(getter: (key: string) => FormDataEntryValue | null, audience: "staff" | "manager"): NotificationPrefs {
  const out: NotificationPrefs = {};
  for (const meta of NOTIFICATION_CHANNELS) {
    if (meta.audience !== audience) continue;
    if (meta.alwaysOn) continue;
    // Checkboxes send "on" when checked, nothing when unchecked.
    out[meta.key] = getter(`pref_${meta.key}`) !== null;
  }
  return out;
}
