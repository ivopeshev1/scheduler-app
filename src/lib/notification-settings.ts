/**
 * Shape + defaults for everything on the Settings → Notifications page.
 *
 * These settings are authored by the company owner/permitted manager and
 * stored as JSON on companies.notification_settings. The send-email code
 * (src/lib/notifications.ts, src/lib/event-notifications.ts) will read from
 * here in a follow-up pass — for now this module just persists the prefs.
 */

export type Channels = { email: boolean; text: boolean };

export type LeadTime = {
  value: number;
  unit: "minutes" | "hours" | "days";
};

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
  return {
    staff: { ...d.staff, ...(s.staff ?? {}) },
    manager: { ...d.manager, ...(s.manager ?? {}) },
  };
}
