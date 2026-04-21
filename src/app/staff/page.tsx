import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";

export default async function StaffHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "staff") redirect("/manager");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, session.userId));

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="staff" />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold">Hi {profile ? profile.firstName : user.email.split("@")[0]}</h1>
        <section className="mt-6">
          <h2 className="font-semibold text-sm uppercase text-gray-500 mb-3">My invitations</h2>
          <div className="border rounded-lg p-6 text-center text-gray-500">No open invitations right now.</div>
        </section>
        <section className="mt-8">
          <h2 className="font-semibold text-sm uppercase text-gray-500 mb-3">My confirmed shifts</h2>
          <div className="border rounded-lg p-6 text-center text-gray-500">Nothing on the calendar yet.</div>
        </section>
      </main>
    </div>
  );
}
