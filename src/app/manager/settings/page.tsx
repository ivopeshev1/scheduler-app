import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";

/**
 * Google Drive share URLs point to a viewer page, not the raw image, so browsers
 * can't render them in an <img> tag. Detect the common forms and rewrite them
 * to the thumbnail endpoint (which serves the actual image bytes).
 */
function normalizeLogoUrl(raw: string): string | null {
  if (!raw) return null;
  // https://drive.google.com/file/d/<ID>/view?usp=…
  const m1 = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/.exec(raw);
  if (m1) return `https://drive.google.com/thumbnail?id=${m1[1]}&sz=w400`;
  // https://drive.google.com/open?id=<ID>
  const m2 = /drive\.google\.com\/open\?.*id=([a-zA-Z0-9_-]+)/.exec(raw);
  if (m2) return `https://drive.google.com/thumbnail?id=${m2[1]}&sz=w400`;
  // Already a thumbnail/uc URL, or any other provider — leave it alone
  return raw;
}

async function saveCompanyAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  // Double-check server-side: only owner + permitted managers can mutate settings
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me?.isOwner && !me?.canEditSettings) throw new Error("Forbidden: you don't have permission to edit settings");
  const name = String(formData.get("name") ?? "").trim();
  const logoUrlRaw = String(formData.get("logoUrl") ?? "").trim();
  if (!name) throw new Error("Company name is required");
  const logoUrl = normalizeLogoUrl(logoUrlRaw);

  // Parse the notification rule (auto-expire days) alongside the company fields,
  // so Settings is one single form with no extra round-trips.
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
    .set({ name, logoUrl, priorityExpireDays })
    .where(eq(schema.companies.id, session.companyId));

  revalidatePath("/manager");
  revalidatePath("/manager/settings");
  redirect("/manager/settings?saved=1");
}

export default async function SettingsPage({ searchParams }: { searchParams: { saved?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  // Only the owner — or managers explicitly granted permission — can view
  // company-level settings (name, logo, notifications, etc).
  if (!user?.isOwner && !user?.canEditSettings) {
    redirect("/manager?denied=settings");
  }

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-2xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Company settings</h1>
        <p className="text-sm text-gray-600 mb-6">
          Edit the name that appears in the header and on outgoing emails, or set a logo image URL.
        </p>

        {searchParams.saved === "1" && (
          <div className="mb-4 p-3 border border-green-300 bg-green-50 text-green-800 text-sm rounded">
            Settings saved.
          </div>
        )}

        <form action={saveCompanyAction} className="space-y-5">
          <div>
            <label htmlFor="name" className="label">Company name</label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={company.name}
              required
              className="input"
            />
            <p className="text-xs text-gray-500 mt-1">
              Used in the header, in email subjects ("Flair Projects invite to a shift…"), and in email signoffs.
            </p>
          </div>

          <div>
            <label htmlFor="logoUrl" className="label">Logo URL (optional)</label>
            <input
              id="logoUrl"
              name="logoUrl"
              type="url"
              defaultValue={company.logoUrl ?? ""}
              placeholder="https://example.com/logo.png"
              className="input"
            />
            <p className="text-xs text-gray-500 mt-1">
              Paste a direct image URL. It'll appear as a small icon next to your company name in the header.
              Upload your logo to somewhere publicly accessible (your website, Imgur, Google Drive with public link, etc.) and paste the image link here.
            </p>
            {company.logoUrl && (
              <div className="mt-3 flex items-center gap-3 p-3 border rounded bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={company.logoUrl} alt="current logo" className="h-10 w-10 object-contain rounded bg-white border" />
                <span className="text-xs text-gray-500">Current logo</span>
              </div>
            )}
          </div>

          <section className="border-t pt-5">
            <h2 className="font-semibold mb-1">Notifications</h2>
            <p className="text-sm text-gray-600 mb-4">
              When a priority invite sits this long without the staff accepting or rejecting, it
              auto-expires. The lowest-tier backup is promoted to priority and emailed. If no
              backup exists, you get a heads-up email instead. Leave blank to disable auto-expiry
              (you handle all re-invites manually).
            </p>
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
            <p className="text-xs text-gray-500 mt-2">
              Email history lives on the <Link href="/manager/log" className="underline">Log</Link> page.
            </p>
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
