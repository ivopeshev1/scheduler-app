/**
 * Same-day availability predicate. Centralizes the rule used across the
 * app: an invitation blocks a staffer from being invited to another event
 * on the same day only when ALL of these are true:
 *
 *   - status is still active (pending or accepted),
 *   - the invitation hasn't been cancelled by manager or staff,
 *   - the event itself hasn't been cancelled.
 *
 * Hard-deleted invitations / hard-deleted events never get here because
 * the row is gone. "expired" and "rejected" statuses release the day too.
 *
 * Extracted so there's exactly one place to change the rule — and so the
 * tests can catch any future drift between the various removal paths.
 */

export type AvailabilityInvite = {
  status: "pending" | "accepted" | "rejected" | "expired" | "filled";
  tier?: number;
  cancelledAt?: Date | null;
  isOnCall?: boolean | null;
  sentAt?: Date | null;
};

export type AvailabilityEvent = {
  cancelledAt?: Date | null;
};

export function invitationBlocksDay(
  inv: AvailabilityInvite,
  event: AvailabilityEvent,
): boolean {
  if (event.cancelledAt) return false;
  if (inv.cancelledAt) return false;
  if (inv.status !== "pending" && inv.status !== "accepted") return false;
  // Silent-backup model: a pending backup (tier > 0) that was never
  // actually emailed doesn't block the staffer. They don't know they're
  // queued; the system is just holding their name in reserve. The
  // cascade re-checks availability at promotion time, so if the backup
  // got booked elsewhere in the meantime we skip them. On-call standby
  // is a separate pool and still blocks (they explicitly accepted the
  // standby fee for keeping the window clear).
  if (
    inv.status === "pending" &&
    (inv.tier ?? 0) > 0 &&
    !inv.isOnCall &&
    !inv.sentAt
  ) {
    return false;
  }
  return true;
}
