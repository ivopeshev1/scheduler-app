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

/** Defaults: email on everywhere, SMS off everywhere. SMS has to be
 *  explicitly opted into per channel so a staffer doesn't start getting
 *  texts for every event change just because they filled in a phone. */
const DEFAULT_CHANNELS: Readonly<ChannelPrefs> = Object.freeze({ email: true, sms: false });

export const DEFAULT_PREFS: Readonly<Record<NotificationKey, ChannelPrefs>> = Object.freeze(
  Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c.key, DEFAULT_CHANNELS])) as Record<NotificationKey, ChannelPrefs>,
);

/**
 * Does this user currently want to receive this notification on this
 * channel? Pass whatever's stored on users.notification_preferences and
 * the (key, channel) being checked.
 *
 * Staff rule: email is always-on for every staff channel. If the user
 * is staff, they can only opt out of SMS. The app's job is to tell
 * them when they're invited / cancelled / changed - email is the
 * floor. SMS is the extra.
 */
export function userWantsNotification(stored: unknown, key: NotificationKey, delivery: Delivery = "email"): boolean {
  const meta = NOTIFICATION_CHANNELS.find((c) => c.key === key);
  // alwaysOn locks EMAIL only - "required" means we must email you about
  // this; SMS stays your call because a 2am password-reset text would be
  // worse than the email it duplicates.
  if (meta?.alwaysOn && delivery === "email") return true;
  if (meta?.audience === "staff" && delivery === "email") return true;
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
    // Email on everywhere; SMS off everywhere by default. Users opt in
    // per channel so a phone number on the profile doesn't start blasting
    // texts the moment it's saved.
    out[meta.key] = { email: true, sms: false };
    if (stored && typeof stored === "object") {
      const entry = (stored as Record<string, unknown>)[meta.key];
      if (typeof entry === "boolean") {
        out[meta.key] = { email: entry, sms: entry };
      } else if (entry && typeof entry === "object") {
        const em = (entry as Record<string, unknown>).email;
        const sm = (entry as Record<string, unknown>).sms;
        if (typeof em === "boolean") out[meta.key].email = em;
        if (typeof sm === "boolean") out[meta.key].sms = sm;
      }
    }
    // Email floor: alwaysOn + staff audience both lock email on.
    if (meta.alwaysOn || meta.audience === "staff") out[meta.key].email = true;
  }
  return out;
}

/** Build a stored-shaped prefs object from a submitted form. */
export function prefsFromFormData(getter: (key: string) => FormDataEntryValue | null, audience: "staff" | "manager"): NotificationPrefs {
  const out: NotificationPrefs = {};
  for (const meta of NOTIFICATION_CHANNELS) {
    if (meta.audience !== audience) continue;
    // SMS is user-choosable on every channel (even alwaysOn). Email is
    // locked on for staff + for every alwaysOn channel; otherwise reads
    // the checkbox state.
    const emailLocked = meta.alwaysOn || audience === "staff";
    out[meta.key] = {
      email: emailLocked ? true : getter(`pref_${meta.key}_email`) !== null,
      sms: getter(`pref_${meta.key}_sms`) !== null,
    };
  }
  return out;
}
