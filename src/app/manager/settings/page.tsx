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
  const name = String(formData.get("name") ?? "").trim();
  const logoUrlRaw = String(formData.get("logoUrl") ?? "").trim();
  if (!name) throw new Error("Company name is required");
  const logoUrl = normalizeLogoUrl(logoUrlRaw);

  await db
    .update(schema.companies)
    .set({ name, logoUrl })
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

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} />
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

          <div className="flex gap-3 pt-4 border-t">
            <button type="submit" className="btn btn-primary">Save</button>
            <Link href="/manager" className="btn btn-secondary">Cancel</Link>
          </div>
        </form>
      </main>
    </div>
  );
}
