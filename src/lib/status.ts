import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

export type PositionStatus = {
  label: string;
  state: "pending" | "confirmed";
};

export async function summarizePosition(positionId: string): Promise<PositionStatus> {
  const slotRows = await db.select().from(schema.slots).where(eq(schema.slots.positionId, positionId));
  const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, positionId));

  const total = slotRows.length;
  const filled = slotRows.filter((s) => s.acceptedUserId).length;
  const invited = invites.filter((i) => i.status === "pending" && i.sentAt).length;
  const open = total - filled;

  if (total === 1) {
    if (filled === 1) return { label: "Filled", state: "confirmed" };
    if (invited > 0) return { label: invited === 1 ? "Invited" : `${invited} invited`, state: "pending" };
    return { label: "Open", state: "pending" };
  }

  if (filled === total) return { label: `${filled} Filled`, state: "confirmed" };
  const parts: string[] = [];
  if (filled > 0) parts.push(`${filled} Filled`);
  if (invited > 0) parts.push(`${invited} invited`);
  if (open > 0) parts.push(`${open} Open`);
  return {
    label: parts.join(" / "),
    state: filled > 0 && invited === 0 && open === 0 ? "confirmed" : "pending",
  };
}
