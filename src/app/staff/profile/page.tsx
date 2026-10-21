import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { revalidatePath } from "next/cache";
import { ProfilePhotoField } from "@/components/ProfilePhotoField";

/**
 * Staff "My profile" page. Covers everything the staffer entered during
 * onboarding — phone, city, DOB, uniform, emergency contact, and photo.
 * Password + security + notifications live on /staff/settings so this
 * page stays focused on "who you are and how to reach you."
 *
 * Name + email are manager-controlled, so they render read-only.
 */

async function saveProfileAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "staff") throw new Error("Unauthorized");

  const phone = String(formData.get("phone") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim() || null;
  const dob = String(formData.get("dob") ?? "").trim() || null;
  const emergencyName = String(formData.get("emergencyName") ?? "").trim();
  const emergencyPhone = String(formData.get("emergencyPhone") ?? "").trim();
  const uniformSize = String(formData.get("uniformSize") ?? "").trim() || null;
  const photoUrl = String(formData.get("photoUrl") ?? "").trim() || null;

  if (!phone) redirect("/staff/profile?err=phone");
  if (!emergencyName || !emergencyPhone) redirect("/staff/profile?err=emergency");

  await db
    .update(schema.staffProfiles)
    .set({
      phone,
      city,
      dateOfBirth: dob,
      emergencyContactName: emergencyName,
      emergencyContactPhone: emergencyPhone,
      uniformSize,
      photoUrl,
    })
    .where(eq(schema.staffProfiles.userId, session.userId));
  revalidatePath("/staff/profile");
  redirect("/staff/profile?saved=1");
}

export default async function StaffProfilePage({
  searchParams,
}: {
  searchParams: { err?: string; saved?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "staff") redirect("/manager");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));

  const err = searchParams.err;
  const errMessage =
    !err ? null
    : err === "phone" ? "Phone number is required."
    : err === "emergency" ? "Both emergency contact name and phone are required."
    : err;
  const saved = searchParams.saved === "1";

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" logoUrl={company.logoUrl} />
      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link href="/staff" className="text-sm text-gray-500 hover:underline">← Back to my shifts</Link>
          <h1 className="text-2xl font-semibold mt-2">My profile</h1>
          <p className="text-sm text-gray-600 mt-1">
            Personal details for <strong>{profile?.firstName} {profile?.lastName}</strong>.
            Need your name or email changed? Message your manager at {company.name}.
          </p>
        </div>

        {errMessage && (
          <div className="border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">{errMessage}</div>
        )}
        {saved && (
          <div className="border border-green-300 bg-green-50 text-green-800 text-sm rounded p-3">
            Profile saved.
          </div>
        )}

        <section className="border rounded-lg bg-white p-6">
          <form action={saveProfileAction} className="space-y-5">
            {/* Read-only basics */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Name</label>
                <div className="input bg-gray-50 cursor-not-allowed">
                  {profile?.firstName} {profile?.lastName}
                </div>
              </div>
              <div>
                <label className="label">Email</label>
                <div className="input bg-gray-50 cursor-not-allowed">{user.email}</div>
              </div>
            </div>

            {/* Contact */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="phone" className="label">Phone <span className="text-red-500">*</span></label>
                <input id="phone" name="phone" type="tel" required defaultValue={profile?.phone ?? ""} className="input" />
              </div>
              <div>
                <label htmlFor="city" className="label">City</label>
                <input id="city" name="city" type="text" defaultValue={profile?.city ?? ""} className="input" placeholder="e.g. Los Angeles" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="dob" className="label">Date of birth</label>
                <input id="dob" name="dob" type="date" defaultValue={profile?.dateOfBirth ?? ""} className="input" />
                <p className="text-xs text-gray-500 mt-1">Used to confirm you&apos;re old enough for 21+ roles.</p>
              </div>
              <div>
                <label htmlFor="uniformSize" className="label">Uniform size</label>
                <select id="uniformSize" name="uniformSize" defaultValue={profile?.uniformSize ?? ""} className="input">
                  <option value="">Prefer not to say</option>
                  <option value="XS">XS</option>
                  <option value="S">S</option>
                  <option value="M">M</option>
                  <option value="L">L</option>
                  <option value="XL">XL</option>
                  <option value="XXL">XXL</option>
                </select>
              </div>
            </div>

            {/* Emergency contact */}
            <div className="border-t pt-5">
              <h3 className="font-semibold text-sm mb-3">Emergency contact</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="emergencyName" className="label">Name <span className="text-red-500">*</span></label>
                  <input id="emergencyName" name="emergencyName" required defaultValue={profile?.emergencyContactName ?? ""} className="input" />
                </div>
                <div>
                  <label htmlFor="emergencyPhone" className="label">Phone <span className="text-red-500">*</span></label>
                  <input id="emergencyPhone" name="emergencyPhone" type="tel" required defaultValue={profile?.emergencyContactPhone ?? ""} className="input" />
                </div>
              </div>
            </div>

            {/* Photo */}
            <div className="border-t pt-5">
              <h3 className="font-semibold text-sm mb-1">Profile photo</h3>
              <p className="text-sm text-gray-600 mb-3">
                Shows up as your avatar across the app. Optional, but handy so teammates and your manager know who to look for on event day.
              </p>
              <ProfilePhotoField initialDataUrl={profile?.photoUrl ?? null} />
            </div>

            <button type="submit" className="btn btn-primary">Save profile</button>
          </form>
        </section>
      </main>
    </div>
  );
}
