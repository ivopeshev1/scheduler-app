/**
 * Per-user notification preferences. Each channel has an Email toggle
 * and an SMS toggle, so the user can get texts for urgent things and
 * ignore the email, or vice versa.
 *
 * Storage shape (on users.notification_preferences, JSONB):
 *   { shiftReminder: { email: true, sms: false }, ... }
 *
 * Backward compat: if an older row stored a plain boolean (one-channel
 * version), we read it as { email: <bool>, sms: <bool> } so no data
 * is lost.
 *
 * Rules:
 *  - A missing key / missing channel falls back to DEFAULT_PREFS (true).
 *  - Channels flagged alwaysOn: true cannot be turned off (password
 *    reset, account suspension / removal, shift invites — those are
 *    the whole point of the app).
 */

export type Delivery = "email" | "sms";

export type NotificationKey =
  // Staff-facing
  | "shiftInvite" // alwaysOn: the whole point - staff must know when invited
  | "shiftReminder" // Day-before + morning-of reminder
  | "beoSent" // BEO document sent / updated for your shift
  | "eventChanged" // Date / time / venue change on a shift you're on
  | "eventCancelled" // Manager cancelled the event
  | "paidReceipt" // You've been marked paid for a shift
  | "accountChange" // alwaysOn: account suspended / restored / removed
  | "passwordReset" // alwaysOn: forgot-password
  // Manager-facing
  | "inviteResponse" // A staffer accepted or declined
  | "staffCancellation" // alwaysOn: must know when someone bails
  | "dailyDigest" // Daily digest summary
  | "urgentOpenShifts" // alwaysOn: approaching date, unfilled
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
  { key: "shiftInvite", label: "Shift invites", description: "A manager invited you to a new shift. Can't be turned off — this is how work gets to you.", audience: "staff", alwaysOn: true },
  { key: "shiftReminder", label: "Shift reminders", description: "Automatic reminder the day before + morning of each shift.", audience: "staff" },
  { key: "beoSent", label: "BEO sent / updated", description: "The manager sent or updated the BEO (banquet event order) for a shift you're on.", audience: "staff" },
  { key: "eventChanged", label: "Event changes", description: "The date, time, or venue of a shift you're on changed.", audience: "staff" },
  { key: "eventCancelled", label: "Event cancelled", description: "A shift you were confirmed for was cancelled by the manager.", audience: "staff" },
  { key: "paidReceipt", label: "Payment receipts", description: "You were marked paid for a shift.", audience: "staff" },
  { key: "accountChange", label: "Account changes", description: "Your account was suspended, restored, or removed. Always on for security.", audience: "staff", alwaysOn: true },
  { key: "passwordReset", label: "Password reset", description: "Forgot-password email. Always on for security.", audience: "staff", alwaysOn: true },
  // Manager
  { key: "inviteResponse", label: "Invite responses", description: "A staffer accepted or declined an invite you sent.", audience: "manager" },
  { key: "staffCancellation", label: "Staff cancellations", description: "A staffer self-cancelled a confirmed shift. Can't be turned off — you need time to find a replacement.", audience: "manager", alwaysOn: true },
  { key: "dailyDigest", label: "Daily digest", description: "End-of-day summary of changes and open shifts.", audience: "manager" },
  { key: "urgentOpenShifts", label: "Urgent open-shift alerts", description: "Alert when an open shift crosses the urgent threshold. Can't be turned off — these are the ones that fall through the cracks.", audience: "manager", alwaysOn: true },
  { key: "backupNudge", label: "Backup nudges", description: "Mid-window + last-call nudges to approve backup promotions.", audience: "manager" },
] as const;

export type ChannelPrefs = { email: boolean; sms: boolean };
export type NotificationPrefs = Partial<Record<NotificationKey, Partial<ChannelPrefs>>>;

/** All optional notifications default to on across both channels. */
const DEFAULT_CHANNELS: Readonly<ChannelPrefs> = Object.freeze({ email: true, sms: true });

export const DEFAULT_PREFS: Readonly<Record<NotificationKey, ChannelPrefs>> = Object.freeze(
  Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c.key, DEFAULT_CHANNELS])) as Record<NotificationKey, ChannelPrefs>,
);

/**
 * Does this user currently want to receive this notification on this
 * channel? Pass whatever's stored on users.notification_preferences and
 * the (key, channel) being checked.
 */
export function userWantsNotification(stored: unknown, key: NotificationKey, delivery: Delivery = "email"): boolean {
  const meta = NOTIFICATION_CHANNELS.find((c) => c.key === key);
  if (meta?.alwaysOn) return true;
  if (!stored || typeof stored !== "object") return DEFAULT_CHANNELS[delivery];
  const entry = (stored as Record<string, unknown>)[key];
  // Backward compat: older rows stored a plain boolean.
  if (typeof entry === "boolean") return entry;
  if (entry && typeof entry === "object") {
    const v = (entry as Record<string, unknown>)[delivery];
    if (typeof v === "boolean") return v;
  }
  return DEFAULT_CHANNELS[delivery];
}

/**
 * Resolve stored prefs into a full per-channel map so the Settings form
 * can render the right initial checkbox state everywhere. alwaysOn
 * channels are forced to true on both channels.
 */
export function resolvePreferences(stored: unknown): Record<NotificationKey, ChannelPrefs> {
  const out = {} as Record<NotificationKey, ChannelPrefs>;
  for (const meta of NOTIFICATION_CHANNELS) {
    if (meta.alwaysOn) {
      out[meta.key] = { email: true, sms: true };
      continue;
    }
    out[meta.key] = { ...DEFAULT_CHANNELS };
    if (stored && typeof stored === "object") {
      const entry = (stored as Record<string, unknown>)[meta.key];
      if (typeof entry === "boolean") {
        // Legacy single-channel value — carry it through on both.
        out[meta.key] = { email: entry, sms: entry };
      } else if (entry && typeof entry === "object") {
        const em = (entry as Record<string, unknown>).email;
        const sm = (entry as Record<string, unknown>).sms;
        if (typeof em === "boolean") out[meta.key].email = em;
        if (typeof sm === "boolean") out[meta.key].sms = sm;
      }
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
    out[meta.key] = {
      email: getter(`pref_${meta.key}_email`) !== null,
      sms: getter(`pref_${meta.key}_sms`) !== null,
    };
  }
  return out;
}
