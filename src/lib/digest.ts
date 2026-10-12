/**
 * Pure classification helpers for the manager's daily digest email.
 *
 * Given a flat list of invitation + position + event tuples (loaded by
 * the cron handler), buckets each line into one of four digest sections:
 *   - urgent      — shift is closer than urgentThresholdHours and has
 *                   open slots, OR priority silent + no backup on a
 *                   near-term shift. These also fire immediately as
 *                   their own email; the digest just restates them.
 *   - waiting     — invites still open, but shift is far enough out
 *                   that nothing is on fire yet.
 *   - resolved    — accepts, declines, ghosts, and auto-promotions
 *                   that happened in the past 24h. Pure recap.
 *   - overview    — "N events, M positions, K confirmed, L still open"
 *                   headline numbers for the next 2 weeks.
 *
 * Keeping this pure means the cron handler just loads data, calls this,
 * and renders the email — easy to unit-test the categorization without
 * touching the DB.
 */

export type DigestInput = {
  // When the digest is being generated (so "resolved today" has a cutoff).
  now: Date;
  // Hours-ahead threshold from manager settings. Anything closer than this
  // with openings = urgent.
  urgentThresholdHours: number;
  invites: Array<{
    invitationId: string;
    status: "pending" | "accepted" | "rejected" | "expired" | "filled";
    tier: number; // 0 = priority, >0 = backup
    sentAt: Date | null;
    respondedAt: Date | null;
    cancelledAt: Date | null;
    isOnCall: boolean | null;
    userFirstName: string;
    userLastName: string;
    eventId: string;
    eventClientName: string;
    eventDate: string; // YYYY-MM-DD
    eventCheckInTime: string | null; // HH:MM
    positionRole: string;
    positionNeeded: number;
    // Count of currently-accepted (non-oncall, non-cancelled) invitations on
    // this position. Precomputed by the loader so classification is O(1).
    positionAcceptedCount: number;
    // Does any pending backup exist on this position? Precomputed too.
    positionHasPendingBackup: boolean;
  }>;
};

export type DigestLine = {
  invitationId: string;
  message: string;
  eventClientName: string;
  eventDate: string;
};

export type DigestBuckets = {
  urgent: DigestLine[];
  waiting: DigestLine[];
  resolved: DigestLine[];
  overview: {
    upcomingEvents: number;
    totalPositions: number;
    confirmedSlots: number;
    openSlots: number;
  };
};

/**
 * Hours between a shift start and now. Positive = future, negative = past.
 * Treats missing check-in time as "noon that day" so we still get a
 * reasonable estimate.
 */
export function hoursUntilShift(
  eventDate: string,
  checkInTime: string | null,
  now: Date,
): number {
  const [sh, sm] = (checkInTime ?? "12:00").split(":").map(Number);
  const start = new Date(`${eventDate}T00:00:00Z`);
  start.setUTCHours(Number.isFinite(sh) ? sh : 12, Number.isFinite(sm) ? sm : 0);
  return (start.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export function classifyDigest(input: DigestInput): DigestBuckets {
  const urgent: DigestLine[] = [];
  const waiting: DigestLine[] = [];
  const resolved: DigestLine[] = [];
  const oneDayAgo = new Date(input.now.getTime() - 24 * 60 * 60 * 1000);

  // Group by event so we can compute per-event overview numbers without
  // extra DB roundtrips.
  const eventIds = new Set<string>();
  const positionIds = new Set<string>();
  let confirmed = 0;
  let openSlots = 0;

  // Track which (event + position) we've already summarized so the digest
  // doesn't repeat the same "N open slots" line per invitation.
  const positionAlreadyEmitted = new Set<string>();

  for (const inv of input.invites) {
    eventIds.add(inv.eventId);
    const posKey = `${inv.eventId}::${inv.positionRole}`;
    const hoursAway = hoursUntilShift(inv.eventDate, inv.eventCheckInTime, input.now);
    const name = `${inv.userFirstName} ${inv.userLastName}`.trim();
    const dateLabel = inv.eventDate;

    // Resolved: happened in the last 24h, regardless of event date.
    if (inv.respondedAt && inv.respondedAt >= oneDayAgo) {
      if (inv.cancelledAt) {
        resolved.push({
          invitationId: inv.invitationId,
          message: `${name} was removed from ${inv.positionRole} on ${inv.eventClientName} (${dateLabel})`,
          eventClientName: inv.eventClientName,
          eventDate: inv.eventDate,
        });
      } else if (inv.status === "accepted") {
        resolved.push({
          invitationId: inv.invitationId,
          message: `${name} accepted ${inv.positionRole} on ${inv.eventClientName} (${dateLabel})`,
          eventClientName: inv.eventClientName,
          eventDate: inv.eventDate,
        });
      } else if (inv.status === "rejected") {
        resolved.push({
          invitationId: inv.invitationId,
          message: `${name} declined ${inv.positionRole} on ${inv.eventClientName} (${dateLabel})`,
          eventClientName: inv.eventClientName,
          eventDate: inv.eventDate,
        });
      }
    }

    // Open position inside the urgent threshold = urgent. Only emit once
    // per (event + position); the first still-pending invite we hit wins.
    const posFull = inv.positionAcceptedCount >= inv.positionNeeded;
    const posHasOpenSlot = !posFull;
    if (
      posHasOpenSlot &&
      hoursAway > 0 &&
      hoursAway <= input.urgentThresholdHours &&
      !positionAlreadyEmitted.has(posKey)
    ) {
      const openCount = inv.positionNeeded - inv.positionAcceptedCount;
      const noBackup = !inv.positionHasPendingBackup;
      const warning = noBackup ? " — no backup!" : "";
      urgent.push({
        invitationId: inv.invitationId,
        message: `${inv.eventClientName} (${dateLabel}, in ${Math.round(hoursAway)}h): ${inv.positionRole} has ${openCount} open slot${openCount === 1 ? "" : "s"}${warning}`,
        eventClientName: inv.eventClientName,
        eventDate: inv.eventDate,
      });
      positionAlreadyEmitted.add(posKey);
    }

    // Waiting: pending priority silent beyond 48h out but outside the
    // urgent window. Emits once per position too.
    if (
      inv.status === "pending" &&
      inv.tier === 0 &&
      inv.sentAt &&
      hoursAway > input.urgentThresholdHours &&
      !positionAlreadyEmitted.has(posKey)
    ) {
      waiting.push({
        invitationId: inv.invitationId,
        message: `${name} hasn't responded yet — ${inv.positionRole} on ${inv.eventClientName} (${dateLabel}, in ${Math.round(hoursAway / 24)}d)${inv.positionHasPendingBackup ? " · backups lined up" : " · no backup"}`,
        eventClientName: inv.eventClientName,
        eventDate: inv.eventDate,
      });
      positionAlreadyEmitted.add(posKey);
    }
  }

  // Overview numbers — count unique positions and their slot states.
  const positionCounts = new Map<string, { needed: number; accepted: number }>();
  for (const inv of input.invites) {
    const posKey = `${inv.eventId}::${inv.positionRole}`;
    positionIds.add(posKey);
    if (!positionCounts.has(posKey)) {
      positionCounts.set(posKey, {
        needed: inv.positionNeeded,
        accepted: inv.positionAcceptedCount,
      });
    }
  }
  for (const { needed, accepted } of positionCounts.values()) {
    confirmed += Math.min(accepted, needed);
    openSlots += Math.max(0, needed - accepted);
  }

  // Sort each section by shift date ascending so the manager scans the
  // soonest problems first.
  const bySoonest = (a: DigestLine, b: DigestLine) => a.eventDate.localeCompare(b.eventDate);
  urgent.sort(bySoonest);
  waiting.sort(bySoonest);
  resolved.sort(bySoonest);

  return {
    urgent,
    waiting,
    resolved,
    overview: {
      upcomingEvents: eventIds.size,
      totalPositions: positionIds.size,
      confirmedSlots: confirmed,
      openSlots,
    },
  };
}
