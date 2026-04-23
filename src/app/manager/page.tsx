import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

/**
 * Manager landing router. Owners always go to the list calendar - grid is a
 * click away via the toggle. Non-owner managers are routed to the first
 * section they have access to, so a manager restricted to Staff only doesn't
 * hit a calendar redirect loop.
 */
export default async function ManagerIndex() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me) redirect("/login");

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const isOwner = !!me.isOwner;
  if (isOwner || me.canAccessCalendar) redirect(`/manager/month/${month}`);
  if (me.canAccessStaff) redirect("/manager/staff");
  if (me.canAccessLog) redirect("/manager/log");
  if (me.canAccessTeam) redirect("/manager/team");
  if (me.canEditSettings) redirect("/manager/settings");

  // No sections granted - send them to a no-access placeholder.
  redirect("/login?error=no-access");
}
