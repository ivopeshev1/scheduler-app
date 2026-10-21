import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { buildIcs } from "@/lib/ics";

/**
 * GET /staff/shift/[inviteId]/ics — returns a single-event .ics file for
 * the staffer's own shift. The browser downloads it; the OS routes it
 * into Apple Calendar / Google Calendar / Outlook on open.
 *
 * Access control: the invitation must belong to the signed-in staffer
 * (same user id). Anonymous requests get 401. We intentionally don't
 * expose a public tokenized ICS feed yet — that's a separate feature.
 */
export async function GET(_req: Request, { params }: { params: { inviteId: string } }) {
  const session = await getSession();
  if (!session || session.role !== "staff") return new NextResponse("Unauthorized", { status: 401 });

  const [inv] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, params.inviteId));
  if (!inv || inv.userId !== session.userId) return new NextResponse("Not found", { status: 404 });

  const [pos] = await db.select().from(schema.positions).where(eq(schema.positions.id, inv.positionId));
  if (!pos) return new NextResponse("Not found", { status: 404 });
  const [evt] = await db.select().from(schema.events).where(eq(schema.events.id, pos.eventId));
  if (!evt) return new NextResponse("Not found", { status: 404 });
  if (!evt.checkInTime || !evt.endTime) {
    return new NextResponse("This shift doesn't have start / end times set yet.", { status: 400 });
  }
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));

  const summaryParts = [pos.role];
  if (evt.venue) summaryParts.push(`at ${evt.venue}`);
  const descLines: string[] = [];
  if (company?.name) descLines.push(`${company.name} shift`);
  if (evt.city) descLines.push(`City: ${evt.city}`);
  if (evt.clientName) descLines.push(`Client: ${evt.clientName}`);
  if (evt.staffNotes) descLines.push("", evt.staffNotes);

  const ics = buildIcs({
    uid: `shift-${inv.id}@scheduler`,
    summary: summaryParts.join(" "),
    description: descLines.join("\n"),
    location: [evt.venue, evt.city].filter(Boolean).join(", ") || undefined,
    date: evt.date,
    startTime: evt.checkInTime,
    endTime: evt.endTime,
  });

  const filename = `shift-${evt.date}-${(pos.role || "shift").replace(/\s+/g, "_")}.ics`;
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
