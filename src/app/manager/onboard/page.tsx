import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { ProfilePhotoField } from "@/components/ProfilePhotoField";
import { revalidatePath } from "next/cache";

/**
 * Manager profile onboarding form. New managers (owner or invited) land
 * here on first login until they fill it in. The data populates their
 * avatar + display name across the app.
 */
async function saveProfileAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const photoUrl = String(formData.get("photoUrl") ?? "").trim() || null;
  if (!firstName || !lastName) throw new Error("First and last name are required");

  const [existing] = await db
    .select()
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, session.userId));

  if (existing) {
    await db
      .update(schema.managerProfiles)
      .set({ firstName, lastName, phone, city, photoUrl })
      .where(eq(schema.managerProfiles.userId, session.userId));
  } else {
    await db.insert(schema.managerProfiles).values({
      userId: session.userId,
      firstName,
      lastName,
      phone,
      city,
      photoUrl,
    });
  }
  revalidatePath("/manager");
  redirect("/manager");
}

export default async function OnboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  const [existing] = await db
    .select()
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, session.userId));

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold mb-2">
          {existing ? "Your profile" : `Welcome to ${company.name}`}
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          {existing
            ? "Update your name, contact info, or photo. Changes show up right away in the header and anywhere you're listed."
            : "Set up your profile so the team knows who you are. Your photo becomes your avatar across the app."}
        </p>
        <form action={saveProfileAction} className="space-y-5">
          <ProfilePhotoField initialDataUrl={existing?.photoUrl ?? null} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="label">First name <span className="text-red-500">*</span></label>
              <input id="firstName" name="firstName" required defaultValue={existing?.firstName ?? ""} className="input" />
            </div>
            <div>
              <label htmlFor="lastName" className="label">Last name <span className="text-red-500">*</span></label>
              <input id="lastName" name="lastName" required defaultValue={existing?.lastName ?? ""} className="input" />
            </div>
          </div>
          <div>
            <label htmlFor="phone" className="label">Phone (optional)</label>
            <input id="phone" name="phone" type="tel" defaultValue={existing?.phone ?? ""} className="input" placeholder="(555) 555-5555" />
          </div>
          <div>
            <label htmlFor="city" className="label">City (optional)</label>
            <input id="city" name="city" defaultValue={existing?.city ?? ""} className="input" />
          </div>
          <div className="pt-2">
            <button type="submit" className="btn btn-primary">
              {existing ? "Save changes" : "Finish setup"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
