/**
 * Shape + defaults for everything on the Settings → Notifications page.
 *
 * These settings are authored by the company owner/permitted manager and
 * stored as JSON on companies.notification_settings. The send-email code
 * (src/lib/notifications.ts, src/lib/event-notifications.ts) will read from
 * here in a follow-up pass - for now this module just persists the prefs.
 */

export type Channels = { email: boolean; text: boolean };

export type LeadTime = {
  value: number;
  unit: "minutes" | "hours" | "days";
};

/**
 * How a per-event-type manager notification should be delivered.
 *   - "immediately"   = send its own email the moment it happens
 *   - "digest"        = roll into the next daily digest email
 *   - "off"           = don't notify at all
 *
 * Safety-critical events (urgent threshold, no-backup, account changes)
 * are always "immediately" — they're not represented here.
 */
export type DeliveryMode = "immediately" | "digest" | "off";

export type NotificationSettings = {
  staff: {
    onboardInvite: Channels;
    onboardReminder: Channels & { frequencyHours: 12 | 24 | 48 };
    onboardMaxReminders: Channels & { count: number };
    shiftInvite: Channels;
    eventCancelled: Channels;
    eventModified: Channels;
    upcomingShift: Channels & { leadTimes: LeadTime[] };
    openShiftReminder: Channels & { frequencyHours: 12 | 24 };
    autoExpire: Channels;
  };
  manager: {
    staffAcceptedOnboard: Channels;
    staffDeclinedOnboard: Channels;
    staffNotCompletedOnboard: Channels;
    staffAcceptedShift: Channels;
    staffDeclinedShift: Channels;
    attentionAlerts: Channels & { leadTimes: LeadTime[] };
    autoExpire: Channels;
    // Per-event-type delivery preferences for the daily-digest era. Each
    // picks one of "immediately" | "digest" | "off". The urgent-threshold
    // cutoff below (shift closer than X hours) forces anything to
    // "immediately" regardless of the setting here.
    delivery: {
      priorityAccepted: DeliveryMode;
      priorityDeclined: DeliveryMode;
      priorityGhosted: DeliveryMode;
      backupAccepted: DeliveryMode;
      backupDeclined: DeliveryMode;
      backupGhosted: DeliveryMode;
      positionStillEmpty: DeliveryMode;
      beoAcknowledged: DeliveryMode;
    };
    // When a shift is closer than this many hours away, every gap on it
    // (unfilled slot, missing BEO ack, etc.) gets escalated to an
    // out-of-cycle urgent email, overriding `delivery` above.
    urgentThresholdHours: 12 | 24 | 48 | 72;
    // Local time the daily digest email goes out. Picked by the owner;
    // defaults to 09:00 in the company's timezone.
    digestHourLocal: number; // 0..23
  };
};

// Defaults per Ivo's product spec. Most staff-facing notifications preset to
// email+text (at least one required). Most manager-facing ones preset to email
// only, except the ones that really benefit from a text ping too (declined
// shift, attention alerts).
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  staff: {
    onboardInvite:       { email: true,  text: true },
    onboardReminder:     { email: true,  text: true, frequencyHours: 24 },
    onboardMaxReminders: { email: true,  text: true, count: 5 },
    shiftInvite:         { email: true,  text: true },
    eventCancelled:      { email: true,  text: true },
    eventModified:       { email: true,  text: true },
    upcomingShift:       { email: true,  text: true, leadTimes: [{ value: 24, unit: "hours" }] },
    openShiftReminder:   { email: true,  text: true, frequencyHours: 24 },
    autoExpire:          { email: true,  text: true },
  },
  manager: {
    staffAcceptedOnboard:     { email: true,  text: false },
    staffDeclinedOnboard:     { email: true,  text: false },
    staffNotCompletedOnboard: { email: true,  text: false },
    staffAcceptedShift:       { email: true,  text: false },
    staffDeclinedShift:       { email: true,  text: true },
    attentionAlerts:          { email: true,  text: true, leadTimes: [{ value: 24, unit: "hours" }] },
    autoExpire:               { email: true,  text: false },
    delivery: {
      // Good news → batch. Bad news / silence → batch (digest is daily, not
      // instant); real urgency comes from the urgentThresholdHours gate.
      priorityAccepted:    "digest",
      priorityDeclined:    "digest",
      priorityGhosted:     "digest",
      backupAccepted:      "digest",
      backupDeclined:      "digest",
      backupGhosted:       "digest",
      positionStillEmpty:  "digest",
      beoAcknowledged:     "digest",
    },
    urgentThresholdHours: 48,
    digestHourLocal: 9,
  },
};

/**
 * Merge a stored settings blob with the defaults. If the DB column is null,
 * or missing some keys because a newer version added fields the row predates,
 * we fill in from the defaults so the UI always gets a fully-populated object.
 */
export function mergeNotificationSettings(stored: unknown): NotificationSettings {
  const d = DEFAULT_NOTIFICATION_SETTINGS;
  if (!stored || typeof stored !== "object") return d;
  const s = stored as Partial<NotificationSettings>;
  const storedManager = (s.manager ?? {}) as Partial<NotificationSettings["manager"]>;
  return {
    staff: { ...d.staff, ...(s.staff ?? {}) },
    manager: {
      ...d.manager,
      ...storedManager,
      // Deep-merge delivery so a stored partial doesn't drop future keys.
      delivery: { ...d.manager.delivery, ...(storedManager.delivery ?? {}) },
    },
  };
}
