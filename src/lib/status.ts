import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export type PositionStatus = {
  label: string;
  // Optional second line rendered beneath the main label in a smaller,
  // grayer font. Used for e.g. "+2 backups invited" under the priority
  // invitee's name.
  subLabel?: string;
  state: "pending" | "confirmed";
  // Multi-slot positions render one line per slot: a confirmed name
  // (black), a pending priority name (red), or "Open" (red) for any
  // slot not yet covered. When present, the UI renders this list and
  // ignores `label`. `label` stays populated as a plain-text fallback
  // for places that don't render multi-line (e.g. the month calendar).
  // Each line optionally carries a BEO status so the calendar can show
  // "BEO sent" / "BEO received" next to each accepted staffer.
  lines?: Array<{
    text: string;
    state: "pending" | "confirmed";
    beo?: "sent" | "received";
    // True when this staffer has been marked paid for this shift on
    // the Payroll tab. The calendar list view renders their name in
    // green when this flips on.
    paid?: boolean;
  }>;
  // Position-level invite send state, used on the calendar list view
  // to display "Invited" vs "Invitation not sent" to the right of the
  // staff names. undefined = no invites yet / all confirmed, so nothing
  // extra is shown.
  sendIndicator?: "Invited" | "Invitation not sent";
  // Separate list of on-call standby invitees for this position.
  // Rendered beneath the main roster in italic gray.
  onCallLines?: Array<{
    text: string;
    state: "pending" | "confirmed";
    paid?: boolean;
    // BEO status for on-call invitees who've been emailed the BEO.
    // Mirrors the main-roster beo column semantics.
    beo?: "sent" | "received";
  }>;
};

/**
 * Build the staffing-status label for a single position as it appears in the
 * month calendar and the event detail table. Invitation lifecycle stages we
 * report on, in priority order (left-to-right in multi-slot labels):
 *
 *   Confirmed  - slot has an accepted staff member. Locked in.
 *   Invited    - a priority invite email has been sent, awaiting response.
 *   Drafted    - manager has staged an invitation but hasn't sent the email yet.
 *                Still reserves the staff from being double-booked elsewhere.
 *   Open       - no activity on this slot.
 *
 * Single-slot positions show the person's first name when there's exactly one
 * name to show, so the manager sees at a glance who's on the shift.
 */
export async function summarizePosition(positionId: string): Promise<PositionStatus> {
  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.positionId, positionId));
  const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, positionId));

  const total = slotRows.length;
  const filled = slotRows.filter((s) => s.acceptedUserId).length;
  // On-call invites live outside the tier/slot system - split them out
  // so they don't contaminate the "Invited" counts and the picker /
  // calendar can render them separately.
  const regularInvites = invites.filter((i) => !i.isOnCall);
  const onCallInvites = invites.filter((i) => i.isOnCall && i.status !== "rejected" && i.status !== "expired");
  const sentPendingInvites = regularInvites.filter((i) => i.status === "pending" && i.sentAt);
  const draftInvites = regularInvites.filter((i) => i.status === "pending" && !i.sentAt);
  const invited = sentPendingInvites.length;
  const drafted = draftInvites.length;
  // Split drafts into priority (tier 0) and backups (tier > 0) so the manager
  // sees "{name} + 3 backups" instead of a lumped "4 Backups" when the real
  // state is 1 priority draft + 3 backup drafts.
  const priorityDrafts = draftInvites.filter((i) => i.tier === 0);
  const backupDrafts = draftInvites.filter((i) => i.tier > 0);
  // "Open" = slots with no active priority invite out. Sent invites consume slots;
  // backups are waiting for cascade and don't reduce the open count. Clamp to 0 so
  // a position with more invites than slots doesn't go negative.
  const open = Math.max(0, total - filled - invited);

  async function firstNameOf(userId: string): Promise<string> {
    const [p] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId));
    if (!p) return "?";
    const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    return full || "?";
  }

  // Precompute on-call lines once - every return path spreads them in.
  const onCallLines: Array<{ text: string; state: "pending" | "confirmed"; paid?: boolean; beo?: "sent" | "received" }> = [];
  for (const inv of onCallInvites) {
    const beo = inv.beoReceivedAt ? "received" : inv.beoSentAt ? "sent" : undefined;
    onCallLines.push({
      text: await firstNameOf(inv.userId),
      state: inv.status === "accepted" ? "confirmed" : "pending",
      paid: !!inv.paidAt,
      beo,
    });
  }
  const onCallField = onCallLines.length > 0 ? onCallLines : undefined;

  // "+N backups invited" rendered on its own line beneath the primary name
  // so the roster emphasizes who's on the invite, not the backup count.
  function backupSubLabel(): string | undefined {
    const n = backupDrafts.length;
    if (n === 0) return undefined;
    return `+${n} backup${n === 1 ? "" : "s"} invited`;
  }

  // Position-level send indicator for the calendar list view. We only
  // care about PRIORITY invites here (backups are silent until cascaded,
  // and confirmed/open rows don't need a send prompt).
  //   - Any priority draft present (sent or not) + no priorities actually
  //     sent → "Invitation not sent" (manager still has to click Send)
  //   - At least one priority sent AND some drafts still waiting → also
  //     "Invitation not sent" (there's still work to do)
  //   - All priorities sent, nothing drafted → "Invited"
  //   - No priorities at all → undefined (nothing to say)
  function computeSendIndicator(): "Invited" | "Invitation not sent" | undefined {
    const anyPrioritySent = invited > 0;
    const anyPriorityDraft = priorityDrafts.length > 0;
    if (!anyPrioritySent && !anyPriorityDraft) return undefined;
    if (anyPriorityDraft) return "Invitation not sent";
    return "Invited";
  }
  const sendIndicator = computeSendIndicator();

  // Helper: BEO status for a specific accepted invitation (by slotId).
  function beoFor(slotId: string): "sent" | "received" | undefined {
    const inv = invites.find((i) => i.slotId === slotId && i.status === "accepted");
    if (!inv) return undefined;
    if (inv.beoReceivedAt) return "received";
    if (inv.beoSentAt) return "sent";
    return undefined;
  }
  // Helper: has this accepted invitation been marked paid?
  function paidFor(slotId: string): boolean {
    const inv = invites.find((i) => i.slotId === slotId && i.status === "accepted");
    return !!inv?.paidAt;
  }

  // Single-slot: prefer showing the person's name so the manager sees at a glance who it is.
  if (total === 1) {
    if (filled === 1) {
      const acceptedSlot = slotRows.find((s) => s.acceptedUserId)!;
      const name = await firstNameOf(acceptedSlot.acceptedUserId!);
      const beo = beoFor(acceptedSlot.id);
      const paid = paidFor(acceptedSlot.id);
      return {
        label: name,
        lines: [{ text: name, state: "confirmed", beo, paid }],
        state: "confirmed",
        onCallLines: onCallField,
      };
    }
    // Prefer the sent priority invite's name
    if (invited === 1) {
      return { label: await firstNameOf(sentPendingInvites[0].userId), subLabel: backupSubLabel(), state: "pending", sendIndicator, onCallLines: onCallField };
    }
    // Multiple priority invites competing (e.g. backups auto-promoted after
    // a rejection) - don't pick one name, call it what it is.
    if (invited > 1) {
      return { label: `Open to ${invited} backups`, state: "pending", sendIndicator, onCallLines: onCallField };
    }
    // Nothing sent yet - a priority draft still shows as the primary name
    if (priorityDrafts.length === 1) {
      return { label: await firstNameOf(priorityDrafts[0].userId), subLabel: backupSubLabel(), state: "pending", sendIndicator, onCallLines: onCallField };
    }
    if (priorityDrafts.length > 1) {
      return { label: `Open to ${priorityDrafts.length} backups`, state: "pending", sendIndicator, onCallLines: onCallField };
    }
    // No priority at all, only backups queued
    if (backupDrafts.length === 1) {
      return { label: `${await firstNameOf(backupDrafts[0].userId)} (backup)`, state: "pending", onCallLines: onCallField };
    }
    if (backupDrafts.length > 1) {
      return { label: `${backupDrafts.length} Backups`, state: "pending", onCallLines: onCallField };
    }
    return { label: "Open", state: "pending", onCallLines: onCallField };
  }

  // Multi-slot - render one line per slot, name-first, same style as the
  // single-slot path. Order: confirmed names, then sent priority names, then
  // priority drafts (not sent yet), then "Open" placeholders for the rest.
  const lines: Array<{ text: string; state: "pending" | "confirmed"; beo?: "sent" | "received"; paid?: boolean }> = [];
  for (const s of slotRows) {
    if (s.acceptedUserId) {
      lines.push({ text: await firstNameOf(s.acceptedUserId), state: "confirmed", beo: beoFor(s.id), paid: paidFor(s.id) });
    }
  }
  for (const inv of sentPendingInvites) {
    lines.push({ text: await firstNameOf(inv.userId), state: "pending" });
  }
  for (const inv of priorityDrafts) {
    lines.push({ text: await firstNameOf(inv.userId), state: "pending" });
  }
  while (lines.length < total) {
    lines.push({ text: "Open", state: "pending" });
  }

  const allConfirmed = lines.every((l) => l.state === "confirmed");
  const plainLabel = allConfirmed ? `${total} Confirmed` : lines.map((l) => l.text).join(", ");
  return {
    label: plainLabel,
    lines,
    subLabel: backupSubLabel(),
    state: allConfirmed ? "confirmed" : "pending",
    sendIndicator,
    onCallLines: onCallField,
  };
}
