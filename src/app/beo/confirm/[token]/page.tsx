import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { formatDate } from "@/lib/format";

/**
 * Staff-facing confirmation page reached from the "Confirm I received the BEO"
 * button in the BEO email. Hitting this URL marks the invitation as received
 * and displays a thank-you. Idempotent - already-confirmed just show the same
 * success page.
 */
export default async function BeoConfirmPage({ params }: { params: { token: string } }) {
  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.beoToken, params.token));
  if (!inv) {
    return (
      <main className="max-w-md mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold mb-4">Link not recognized</h1>
        <p className="text-gray-600">This confirmation link isn't valid. If you believe this is a mistake, contact your manager.</p>
      </main>
    );
  }

  const [pos] = await db.select().from(schema.positions).where(eq(schema.positions.id, inv.positionId));
  const [event] = pos ? await db.select().from(schema.events).where(eq(schema.events.id, pos.eventId)) : [null];

  const alreadyConfirmed = !!inv.beoReceivedAt;
  if (!alreadyConfirmed) {
    await db.update(schema.invitations).set({ beoReceivedAt: new Date() }).where(eq(schema.invitations.id, inv.id));
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16 text-center">
      <div className="text-5xl mb-4">✅</div>
      <h1 className="text-2xl font-semibold mb-2">
        {alreadyConfirmed ? "Already confirmed" : "BEO receipt confirmed"}
      </h1>
      <p className="text-gray-600">
        Thanks{event ? `, we recorded that you've got the BEO for ${event.clientName} on ${formatDate(event.date)}.` : "."}
      </p>
    </main>
  );
}
