import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";

async function saveNotificationSettingsAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  // Notification rules are gated the same as company settings — owner or
  // explicitly granted access.
  if (!me?.isOwner && !me?.canEditSettings) throw new Error("Forbidden: you don't have permission to edit notification settings");

  const expireRaw = String(formData.get("priorityExpireDays") ?? "").trim();
  let priorityExpireDays: number | null = null;
  if (expireRaw) {
    const n = Number(expireRaw);
    if (Number.isFinite(n) && n >= 1) {
      priorityExpireDays = Math.min(60, Math.max(1, Math.floor(n)));
    }
  }

  await db
    .update(schema.companies)
    .set({ priorityExpireDays })
    .where(eq(schema.companies.id, session.companyId));

  revalidatePath("/manager/notifications");
  redirect("/manager/notifications?saved=1");
}

export default async function NotificationSettingsPage({ searchParams }: { searchParams: { saved?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user?.isOwner && !user?.canEditSettings) {
    redirect("/manager?denied=notifications");
  }

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-2xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Notifications</h1>
        <p className="text-sm text-gray-600 mb-6">
          Rules that control how staff invitations age out and how backups get promoted automatically. To see
          a history of every email that went out, check the <Link href="/manager/log" className="underline">Log</Link>.
        </p>

        {searchParams.saved === "1" && (
          <div className="mb-4 p-3 border border-green-300 bg-green-50 text-green-800 text-sm rounded">
            Saved.
          </div>
        )}

        <form action={saveNotificationSettingsAction} className="space-y-5">
          <section className="border rounded-lg bg-white p-5">
            <h2 className="font-semibold mb-1">Auto-expiry</h2>
            <p className="text-sm text-gray-600 mb-4">
              When a priority invite sits this long without the staff accepting or rejecting, it auto-expires.
              The lowest-tier backup is promoted to priority and emailed. If no backup exists, you get
              a heads-up email instead. Leave blank to disable auto-expiry (you handle all re-invites manually).
            </p>
            <div>
              <label htmlFor="priorityExpireDays" className="label">
                Auto-expire priority invites after
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="priorityExpireDays"
                  name="priorityExpireDays"
                  type="number"
                  min={1}
                  max={60}
                  defaultValue={company.priorityExpireDays ?? ""}
                  placeholder="—"
                  className="input w-24"
                />
                <span className="text-sm text-gray-700">days with no response</span>
              </div>
            </div>
          </section>

          <div className="flex gap-3 pt-4">
            <button type="submit" className="btn btn-primary">Save</button>
            <Link href="/manager" className="btn btn-secondary">Cancel</Link>
          </div>
        </form>
      </main>
    </div>
  );
}
