import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, makeInviteToken } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { StaffRolesEditor } from "@/components/StaffRolesEditor";
import { nanoid } from "nanoid";

async function addStaffAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  type ParsedRoleRow = { role: string; rate: number; rateType: "hourly" | "flat" };
  const roleRows: ParsedRoleRow[] = (() => {
    try {
      const raw = JSON.parse(String(formData.get("staffRoles") ?? "[]"));
      if (!Array.isArray(raw)) return [];
      return raw
        .map((r: unknown): ParsedRoleRow | null => {
          if (!r || typeof r !== "object") return null;
          const o = r as Record<string, unknown>;
          const role = typeof o.role === "string" ? o.role.trim() : "";
          const rateStr = typeof o.rate === "string" ? o.rate : typeof o.rate === "number" ? String(o.rate) : "";
          const rateNum = Number(rateStr);
          const rateType = o.rateType === "flat" ? "flat" : "hourly";
          if (!role || !Number.isFinite(rateNum) || rateNum < 0) return null;
          return { role, rate: rateNum, rateType };
        })
        .filter((r: ParsedRoleRow | null): r is ParsedRoleRow => r !== null);
    } catch {
      return [];
    }
  })();

  if (!firstName || !lastName || !email || roleRows.length === 0) {
    redirect("/manager/staff/new?err=" + encodeURIComponent("First name, last name, email, and at least one role are required."));
  }
  const primary = roleRows[0];

  // Duplicate-email handling. The unique index is on (companyId, email), so
  // a soft-deleted (archivedAt-set) prior row with the same email still
  // blocks a straight insert. If the existing row is archived we resurrect
  // it (so "removed then re-added" works); if it's active we bounce back
  // to the form with an inline error.
  const existing = await db.select().from(schema.users).where(
    and(eq(schema.users.companyId, session.companyId), eq(schema.users.email, email)),
  );
  const archivedPrior = existing.find((u) => u.archivedAt && u.role === "staff");
  const activePrior = existing.find((u) => !u.archivedAt);
  if (activePrior) {
    redirect("/manager/staff/new?err=" + encodeURIComponent(`A user with email ${email} already exists in your company.`));
  }

  const userId = archivedPrior ? archivedPrior.id : nanoid();
  const inviteToken = makeInviteToken();
  if (archivedPrior) {
    // Resurrect: clear archivedAt, reset password/onboarding so they go
    // through the invite flow again, issue a fresh invite token.
    await db
      .update(schema.users)
      .set({
        archivedAt: null,
        suspendedAt: null,
        inviteToken,
        inviteAcceptedAt: null,
        passwordHash: null,
      })
      .where(eq(schema.users.id, userId));
  } else {
    await db.insert(schema.users).values({
      id: userId,
      companyId: session.companyId,
      email,
      role: "staff",
      inviteToken,
    });
  }

  // Manager-side onboarding only captures what's needed to send the
  // invite email. Phone, DOB, shirt size, emergency contact, and the
  // rest of the personal details are filled in by the staffer when
  // they accept their invite - we leave those columns null.
  const existingProfile = archivedPrior
    ? await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId))
    : [];
  if (existingProfile.length > 0) {
    await db
      .update(schema.staffProfiles)
      .set({
        firstName,
        lastName,
        position: primary.role,
        defaultRate: primary.rate,
        defaultRateType: primary.rateType,
      })
      .where(eq(schema.staffProfiles.userId, userId));
  } else {
    await db.insert(schema.staffProfiles).values({
      userId,
      firstName,
      lastName,
      position: primary.role,
      defaultRate: primary.rate,
      defaultRateType: primary.rateType,
    });
  }
  // Clear old role/location rows so the resurrected user gets exactly
  // what's in this form, not what they used to have.
  if (archivedPrior) {
    await db.delete(schema.staffRoles).where(eq(schema.staffRoles.userId, userId));
    await db.delete(schema.userLocations).where(eq(schema.userLocations.userId, userId));
  }

  // Dedupe + persist every role the manager configured. Primary already
  // lives on the profile as a fallback; the real list is here.
  // First, make sure any brand-new role names (typed via the "+ Add new role"
  // option in the dropdown) are added to the company's role catalog, so they
  // show up for future staffers too.
  const catalog = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.companyId, session.companyId));
  const catalogNames = new Set(catalog.map((r) => r.name.toLowerCase()));
  const maxSortOrder = catalog.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  let nextOrder = maxSortOrder;
  const addedThisTurn = new Set<string>();
  for (const r of roleRows) {
    const key = r.role.toLowerCase();
    if (catalogNames.has(key) || addedThisTurn.has(key)) continue;
    nextOrder += 10;
    await db.insert(schema.roles).values({
      id: nanoid(),
      companyId: session.companyId,
      name: r.role,
      sortOrder: nextOrder,
    });
    addedThisTurn.add(key);
  }

  const seen = new Set<string>();
  for (const r of roleRows) {
    if (seen.has(r.role)) continue;
    seen.add(r.role);
    await db.insert(schema.staffRoles).values({
      id: nanoid(),
      userId,
      role: r.role,
      rate: r.rate,
      rateType: r.rateType,
    });
  }

  // Location assignments. The form sends one "locationIds" entry per picked
  // checkbox. The manager can only assign to locations they themselves have
  // access to (owners pass this freely).
  const requestedLocationIds = formData.getAll("locationIds").map(String).filter(Boolean);
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  const companyLocations = await db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.companyId, session.companyId));
  let allowedForManager: string[];
  if (me?.isOwner) {
    allowedForManager = companyLocations.map((l) => l.id);
  } else {
    const myLocs = await db
      .select({ id: schema.userLocations.locationId })
      .from(schema.userLocations)
      .where(eq(schema.userLocations.userId, session.userId));
    allowedForManager = myLocs.map((r) => r.id);
  }
  const toAssign = requestedLocationIds.filter((id) => allowedForManager.includes(id));
  if (toAssign.length === 0) {
    // Roll back what we just inserted so retrying from the form doesn't
    // trip the duplicate-email guard. For a resurrected user we re-archive
    // (don't hard-delete the historical row); for a brand-new user we drop.
    await db.delete(schema.staffRoles).where(eq(schema.staffRoles.userId, userId));
    if (archivedPrior) {
      await db.update(schema.users).set({ archivedAt: new Date() }).where(eq(schema.users.id, userId));
    } else {
      await db.delete(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    redirect("/manager/staff/new?err=" + encodeURIComponent("Pick at least one location this staffer can work at."));
  }
  for (const locId of toAssign) {
    await db.insert(schema.userLocations).values({ userId, locationId: locId });
  }

  redirect("/manager/staff");
}

export default async function AddStaffPage({ searchParams }: { searchParams: { err?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  if (!user.isOwner && !user.canAccessStaff) redirect("/manager?denied=staff");

  // Role catalog for this company drives the dropdown in the Roles & rates
  // editor. Falls back to the original hardcoded set when the company
  // hasn't configured its own roles yet.
  const companyRoles = await db.select().from(schema.roles).where(eq(schema.roles.companyId, session.companyId));
  companyRoles.sort((a, b) => a.sortOrder - b.sortOrder);
  const roleOptions = companyRoles.length > 0
    ? companyRoles.map((r) => r.name)
    : ["Lead", "Bartender", "Bar Back", "Server", "Cashier"];

  // Locations the current manager can assign a new staffer to. Owners get
  // the full list; non-owners only see the ones they themselves belong to.
  const allLocations = await db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.companyId, session.companyId));
  const sortedLocations = allLocations.filter((l) => !l.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  let assignableLocations: typeof sortedLocations;
  if (user.isOwner) {
    assignableLocations = sortedLocations;
  } else {
    const myLocs = await db
      .select({ id: schema.userLocations.locationId })
      .from(schema.userLocations)
      .where(eq(schema.userLocations.userId, session.userId));
    const mine = new Set(myLocs.map((r) => r.id));
    assignableLocations = sortedLocations.filter((l) => mine.has(l.id));
  }

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Add staff member</h1>
        <p className="text-sm text-gray-600 mb-6">
          Just the basics to send the invite. Phone, address, emergency contact, shirt size and the
          rest will be filled in by the staffer when they accept their invite.
        </p>

        {searchParams.err && (
          <div className="mb-4 border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">
            {searchParams.err}
          </div>
        )}

        <form action={addStaffAction} className="space-y-4">
          <section>
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Basics</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="First name (as on tax docs)" name="firstName" required />
              <Field label="Last name (as on tax docs)" name="lastName" required />
              <Field label="Email" name="email" type="email" required />
            </div>
          </section>

          <section className="pt-6 border-t">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Roles &amp; rates</h2>
            <p className="text-sm text-gray-600 mb-3">
              Add every role this staffer can work and their rate for it. When a shift is set up for
              a given position, the system uses the matching role&apos;s rate automatically.
            </p>
            <StaffRolesEditor roleOptions={roleOptions} initial={[]} />
          </section>

          <section className="pt-6 border-t">
            <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">
              Locations <span className="text-red-500">*</span>
            </h2>
            <p className="text-sm text-gray-600 mb-3">
              Which locations this staffer can work at. They&apos;ll only appear in the invite picker for events at these locations. Pick one or more.
            </p>
            {assignableLocations.length === 0 ? (
              <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded px-3 py-2">
                You&apos;re not assigned to any locations. Ask the owner to add you to one so you can start adding staff.
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {assignableLocations.map((l) => (
                  <label key={l.id} className="inline-flex items-center gap-2 border rounded px-3 py-2 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" name="locationIds" value={l.id} className="w-4 h-4" />
                    <span className="text-sm">{l.name}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <div className="flex gap-3 pt-4 border-t">
            <button type="submit" className="btn btn-primary">Add staff</button>
            <Link href="/manager/staff" className="btn btn-secondary">Cancel</Link>
          </div>
        </form>
      </main>
    </div>
  );
}

function Field({ label, name, type = "text", required }: {
  label: string; name: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} className="input" />
    </div>
  );
}
