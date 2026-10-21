/**
 * Per-user notification preferences. Three dimensions per channel:
 *   - Email: on by default, always locked on (audit-trail floor).
 *   - SMS: off by default, user opts in per channel.
 *   - Delivery mode: when email fires - immediately (individual),
 *     only rolled into the daily digest (summary), or both.
 *
 * Not every channel supports mode. Time-sensitive channels like
 * staffCancellation / urgentOpenShifts / backupPromoted stay locked to
 * "individual" because a digest that lands at 8pm about a shift that
 * started at 5pm isn't useful. Channels with digestable: true render
 * the dropdown and let the user pick.
 *
 * Storage shape on users.notification_preferences:
 *   { <key>: { email: boolean, sms: boolean, emailMode?: "individual" | "summary" | "both" } }
 *
 * Legacy shapes (plain boolean, { email, sms } without emailMode) are
 * read back untouched - missing emailMode means "individual".
 */

export type Delivery = "email" | "sms";
export type EmailMode = "individual" | "summary" | "both";

export type NotificationKey =
  // ---------------- Staff-facing ----------------
  | "shiftInvite" // alwaysOn email: the whole point - staff must know when invited
  | "invitationNudge" // Friendly nudge when you haven't responded to a pending invite
  | "shiftReminder" // Day-before + morning-of reminder on confirmed shifts
  | "beoSent" // BEO document sent / updated for your shift
  | "eventChanged" // Date / time / venue change on a shift you're on
  | "payChanged" // Your rate / pay structure on a confirmed shift changed
  | "eventCancelled" // Manager cancelled the event
  | "paidReceipt" // You've been marked paid for a shift
  | "accountChange" // alwaysOn: account suspended / restored / removed
  | "passwordReset" // alwaysOn: forgot-password

  // ---------------- Manager-facing ----------------
  | "inviteResponse" // Any accept / decline on an invite you sent
  | "staffCancellation" // A staffer self-cancelled a confirmed shift
  | "dailyDigest" // Daily digest itself
  | "urgentOpenShifts" // Open shift / event approaching date with uncovered positions
  | "newStaffJoined" // A staffer completed onboarding
  | "staffPendingOnboarding" // An invited staffer hasn't onboarded in N days
  | "backupPromoted" // A backup was promoted to priority
  | "staffLeft" // A staffer soft-left the company
  | "staffBlockedConflict" // A staffer blocked a day they're already booked on
  | "eventEdited" // Another manager edited an event
  | "weeklyDigest"; // Weekly summary roll-up

export type NotificationChannelMeta = {
  key: NotificationKey;
  label: string;
  description: string;
  audience: "staff" | "manager";
  /** Email can't be turned off (we always keep an audit trail by email). */
  alwaysOn?: boolean;
  /** Whether this channel supports the Individual / Summary / Both picker.
   *  Omit = time-sensitive, forced "individual". */
  digestable?: boolean;
  /** Default delivery mode when nothing is stored. Defaults to "individual"
   *  if omitted. Only consulted for digestable channels. */
  defaultMode?: EmailMode;
};

export const NOTIFICATION_CHANNELS: readonly NotificationChannelMeta[] = [
  // Staff
  { key: "shiftInvite", label: "Shift invites", description: "A manager invited you to a new shift. Can't be turned off — this is how work gets to you.", audience: "staff", alwaysOn: true },
  { key: "invitationNudge", label: "Please-respond nudges", description: "Friendly reminder when you haven't answered a shift invite yet. Fires mid-window and ~3h before the invite expires.", audience: "staff" },
  { key: "shiftReminder", label: "Shift reminders", description: "Automatic reminder the day before + morning of each shift you've accepted.", audience: "staff" },
  { key: "beoSent", label: "BEO sent / updated", description: "The manager sent or updated the BEO (banquet event order) for a shift you're on.", audience: "staff" },
  { key: "eventChanged", label: "Event changes", description: "The date, time, or venue of a shift you're on changed.", audience: "staff" },
  { key: "payChanged", label: "Pay changes", description: "The rate or pay structure on a shift you've accepted changed. Can't be turned off — you need to know what you're being paid.", audience: "staff", alwaysOn: true },
  { key: "eventCancelled", label: "Event cancelled", description: "A shift you were confirmed for was cancelled by the manager.", audience: "staff" },
  { key: "paidReceipt", label: "Payment receipts", description: "You were marked paid for a shift.", audience: "staff" },
  { key: "accountChange", label: "Account changes", description: "Your account was suspended, restored, or removed. Always on for security.", audience: "staff", alwaysOn: true },
  { key: "passwordReset", label: "Password reset", description: "Forgot-password email. Always on for security.", audience: "staff", alwaysOn: true },

  // Manager — every row supports Individual / Summary / Both. Time-sensitive
  // channels default to Individual (and the description nudges you to keep
  // them there), but you can override if your workflow calls for a digest.
  { key: "inviteResponse", label: "Invite responses", description: "A staffer accepted or declined an invite you sent.", audience: "manager", digestable: true },
  { key: "staffCancellation", label: "Staff cancellations", description: "A staffer self-cancelled a confirmed shift. Usually worth keeping on Individual — digest means you find out next morning.", audience: "manager", digestable: true },
  { key: "backupPromoted", label: "Backup promoted to priority", description: "The cascade bumped a backup into a priority slot.", audience: "manager", digestable: true, defaultMode: "summary" },
  { key: "urgentOpenShifts", label: "Urgent / short-staffed events", description: "An event is approaching the urgent threshold with uncovered positions. Set the threshold on Company settings → Notifications. Usually worth keeping on Individual.", audience: "manager", digestable: true },
  { key: "staffBlockedConflict", label: "Blocked-day conflict", description: "A staffer blocked a day they're already booked on. Lets you reach out before it becomes a cancellation.", audience: "manager", digestable: true },
  { key: "newStaffJoined", label: "New staffer onboarded", description: "An invited staffer completed onboarding and is ready to be booked.", audience: "manager", digestable: true, defaultMode: "summary" },
  { key: "staffPendingOnboarding", label: "Pending onboarding reminders", description: "A staffer you invited still hasn't finished onboarding after a few days.", audience: "manager", digestable: true, defaultMode: "summary" },
  { key: "staffLeft", label: "Staffer self-left", description: "A staffer soft-left the company from their own Settings page. Any accepted shifts are already cancelled; follow up if you want them back.", audience: "manager", digestable: true, defaultMode: "summary" },
  { key: "eventEdited", label: "Team member edited an event", description: "Another manager edited an event you can see. Noise for solo owners, useful on multi-manager teams.", audience: "manager", digestable: true },
  { key: "dailyDigest", label: "Daily digest", description: "End-of-day summary covering everything above you've set to Summary.", audience: "manager" },
  { key: "weeklyDigest", label: "Weekly digest", description: "Monday-morning roll-up of last week's shift coverage, cancellations, and payroll status.", audience: "manager" },
] as const;

export type ChannelPrefs = { email: boolean; sms: boolean; emailMode?: EmailMode };
export type NotificationPrefs = Partial<Record<NotificationKey, Partial<ChannelPrefs>>>;

/** Defaults: email on everywhere, SMS off everywhere, mode = individual. */
const DEFAULT_CHANNELS: Readonly<ChannelPrefs> = Object.freeze({ email: true, sms: false, emailMode: "individual" });

export const DEFAULT_PREFS: Readonly<Record<NotificationKey, ChannelPrefs>> = Object.freeze(
  Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c.key, DEFAULT_CHANNELS])) as Record<NotificationKey, ChannelPrefs>,
);

/**
 * Does this user want this notification on this channel?
 *   - Email is always on (floor).
 *   - SMS reads the stored value, default off.
 */
export function userWantsNotification(stored: unknown, key: NotificationKey, delivery: Delivery = "email"): boolean {
  if (delivery === "email") return true;
  if (!stored || typeof stored !== "object") return DEFAULT_CHANNELS[delivery];
  const entry = (stored as Record<string, unknown>)[key];
  if (typeof entry === "boolean") return entry;
  if (entry && typeof entry === "object") {
    const v = (entry as Record<string, unknown>)[delivery];
    if (typeof v === "boolean") return v;
  }
  return DEFAULT_CHANNELS[delivery];
}

/** The user's chosen delivery mode for this channel. Forced "individual"
 *  for channels that aren't digestable. */
export function emailModeFor(stored: unknown, key: NotificationKey): EmailMode {
  const meta = NOTIFICATION_CHANNELS.find((c) => c.key === key);
  if (!meta?.digestable) return "individual";
  const fallback = meta.defaultMode ?? "individual";
  if (!stored || typeof stored !== "object") return fallback;
  const entry = (stored as Record<string, unknown>)[key];
  if (!entry || typeof entry !== "object") return fallback;
  const m = (entry as Record<string, unknown>).emailMode;
  if (m === "individual" || m === "summary" || m === "both") return m;
  return fallback;
}

/**
 * Should an immediate email fire for this (user, channel) right now?
 * Honors the delivery mode: summary-only channels skip the immediate send
 * and only land in the digest. "both" sends immediately and also appears
 * in the digest.
 */
export function shouldSendImmediateEmail(stored: unknown, key: NotificationKey): boolean {
  if (!userWantsNotification(stored, key, "email")) return false;
  const mode = emailModeFor(stored, key);
  return mode === "individual" || mode === "both";
}

/** Should this (user, channel) appear in the daily / weekly digest? */
export function shouldIncludeInDigest(stored: unknown, key: NotificationKey): boolean {
  if (!userWantsNotification(stored, key, "email")) return false;
  const mode = emailModeFor(stored, key);
  return mode === "summary" || mode === "both";
}

export function resolvePreferences(stored: unknown): Record<NotificationKey, ChannelPrefs> {
  const out = {} as Record<NotificationKey, ChannelPrefs>;
  for (const meta of NOTIFICATION_CHANNELS) {
    out[meta.key] = { email: true, sms: false, emailMode: meta.defaultMode ?? "individual" };
    if (stored && typeof stored === "object") {
      const entry = (stored as Record<string, unknown>)[meta.key];
      if (typeof entry === "boolean") {
        out[meta.key] = { email: entry, sms: entry, emailMode: "individual" };
      } else if (entry && typeof entry === "object") {
        const em = (entry as Record<string, unknown>).email;
        const sm = (entry as Record<string, unknown>).sms;
        const mo = (entry as Record<string, unknown>).emailMode;
        if (typeof em === "boolean") out[meta.key].email = em;
        if (typeof sm === "boolean") out[meta.key].sms = sm;
        if (mo === "individual" || mo === "summary" || mo === "both") out[meta.key].emailMode = mo;
      }
    }
    // Email floor: always on. Mode only applies to digestable channels.
    out[meta.key].email = true;
    if (!meta.digestable) out[meta.key].emailMode = "individual";
  }
  return out;
}

export function prefsFromFormData(getter: (key: string) => FormDataEntryValue | null, audience: "staff" | "manager"): NotificationPrefs {
  const out: NotificationPrefs = {};
  for (const meta of NOTIFICATION_CHANNELS) {
    if (meta.audience !== audience) continue;
    const raw = getter(`pref_${meta.key}_mode`);
    const modeStr = typeof raw === "string" ? raw : "individual";
    const emailMode: EmailMode = (modeStr === "summary" || modeStr === "both") ? modeStr : "individual";
    out[meta.key] = {
      email: true,
      sms: getter(`pref_${meta.key}_sms`) !== null,
      // Only persist a mode for digestable channels; otherwise force individual.
      emailMode: meta.digestable ? emailMode : "individual",
    };
  }
  return out;
}
