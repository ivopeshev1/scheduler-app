/**
 * Position-fill lifecycle helpers.
 *
 * When a position reaches its full headcount — because the last priority
 * accepted, an on-call standby got activated, or the manager manually
 * assigned the last slot — any still-pending backup invitations on that
 * position become dead weight. They lock the staffer out of other events
 * on the same day for no reason, since the slot they'd been held for is
 * now filled by someone else.
 *
 * This module centralizes the "should we auto-release?" decision and the
 * list of invitation ids that should get released + emailed. Pure
 * functions — the DB side (status update, email dispatch, revalidation)
 * lives in the server actions that call these.
 */

export type PositionFillInput = {
  // How many slots the position needs filled (positions.needed).
  needed: number;
  // All invitations on this position, raw from the DB. Only status and
  // isOnCall matter for the fill math.
  invites: Array<{
    id: string;
    status: "pending" | "accepted" | "rejected" | "expired" | "filled";
    isOnCall?: boolean | null;
    cancelledAt?: Date | null;
    userId: string;
  }>;
};

/**
 * How many non-on-call accepted invitations the position currently has.
 * Cancelled rows don't count. On-call accepted invitations don't count
 * toward the fill because they're standby — they haven't taken a slot yet.
 */
export function acceptedCount(input: PositionFillInput): number {
  return input.invites.filter(
    (i) => i.status === "accepted" && !i.cancelledAt && !i.isOnCall,
  ).length;
}

/**
 * Is the position fully staffed? True when non-on-call accepted >= needed.
 */
export function isPositionFull(input: PositionFillInput): boolean {
  return acceptedCount(input) >= input.needed;
}

export type ReleaseOutcome = {
  releasedInvitationIds: string[];
  role: string;
};

/**
 * Invitation ids that should be released now. We release every pending,
 * non-on-call, non-cancelled invitation on a fully-filled position. On-
 * call standbys stay put — they're a separate pool with their own
 * economics. Rejected / expired / filled rows are already terminal.
 */
export function pendingToRelease(input: PositionFillInput): string[] {
  if (!isPositionFull(input)) return [];
  return input.invites
    .filter(
      (i) =>
        i.status === "pending" && !i.isOnCall && !i.cancelledAt,
    )
    .map((i) => i.id);
}
