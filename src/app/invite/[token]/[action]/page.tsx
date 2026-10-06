import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { formatDate, formatTime } from "@/lib/format";
import { notFound } from "next/navigation";

/**
 * Public one-click accept / decline landing page reached from the shift
 * invite email. Hitting /invite/<token>/accept or /invite/<token>/decline
 * applies the action and shows a confirmation. Idempotent on repeat clicks:
 * already-handled invites just render the current state.
 *
 * Accepting binds the invite to the lowest-index open slot on the position
 * so the manager's roster flips to "confirmed" (black) immediately. If every
 * slot is already filled by someone else, the user sees "shift filled" and
 * nothing changes.
 */
export default async function InviteActionPage({
  params,
}: {
  params: { token: string; action: string };
}) {
  const action = params.action;
  if (action !== "accept" && action !== "decline") notFound();

  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.token, params.token));
  if (!inv) {
    return (
      <main className="max-w-md mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold mb-2">Link not recognized</h1>
        <p className="text-gray-600">This invite link isn't valid. Check with your manager.</p>
      </main>
    );
  }

  const [pos] = await db.select().from(schema.positions).where(eq(schema.positions.id, inv.positionId));
  const [event] = pos ? await db.select().from(schema.events).where(eq(schema.events.id, pos.eventId)) : [null];
  const prettyDate = event?.date ? formatDate(event.date) : "";
  const timeRange = event ? `${formatTime(event.checkInTime)} – ${formatTime(event.endTime)}` : "";

  // Terminal states - don't re-process, just show the current state.
  let outcome: "accepted" | "declined" | "expired" | "already-filled" | "shift-filled" =
    inv.status === "accepted" ? "accepted"
    : inv.status === "rejected" ? "declined"
    : inv.status === "expired" ? "expired"
    : inv.status === "filled" ? "already-filled"
    : "shift-filled";

  if (inv.status === "pending") {
    if (action === "decline") {
      await db.update(schema.invitations)
        .set({ status: "rejected", respondedAt: new Date() })
        .where(eq(schema.invitations.id, inv.id));
      outcome = "declined";
    } else {
      // Accept: bind to the first open slot on this position.
      const slots = await db.select().from(schema.slots)
        .where(and(eq(schema.slots.positionId, inv.positionId)))
        .orderBy(schema.slots.index);
      const openSlot = slots.find((s) => !s.acceptedUserId);
      if (!openSlot) {
        outcome = "shift-filled";
      } else {
        await db.update(schema.slots)
          .set({ acceptedUserId: inv.userId, acceptedAt: new Date() })
          .where(eq(schema.slots.id, openSlot.id));
        await db.update(schema.invitations)
          .set({ status: "accepted", respondedAt: new Date(), slotId: openSlot.id })
          .where(eq(schema.invitations.id, inv.id));
        outcome = "accepted";
      }
    }
  }

  const headline =
    outcome === "accepted" ? "Shift accepted"
    : outcome === "declined" ? "Shift declined"
    : outcome === "expired" ? "This invite has expired"
    : outcome === "already-filled" ? "This slot was filled by someone else"
    : "Shift already filled";
  const emoji =
    outcome === "accepted" ? "✅"
    : outcome === "declined" ? "👋"
    : "⏳";
  const message =
    outcome === "accepted"
      ? "You're confirmed. We'll send the BEO closer to the date."
      : outcome === "declined"
      ? "Thanks for letting us know. Your manager has been notified."
      : outcome === "expired"
      ? "The response window closed. Reach out to your manager if you still want in."
      : "Someone else accepted this shift first. No action needed on your end.";

  return (
    <main className="max-w-md mx-auto px-6 py-16 text-center">
      <div className="text-5xl mb-4">{emoji}</div>
      <h1 className="text-2xl font-semibold mb-2">{headline}</h1>
      {event && (
        <p className="text-gray-700 mb-2">
          {event.clientName} · {prettyDate}
        </p>
      )}
      {event && pos && (
        <p className="text-gray-500 text-sm mb-4">
          {pos.role} · {timeRange}
        </p>
      )}
      <p className="text-gray-600">{message}</p>
    </main>
  );
}
