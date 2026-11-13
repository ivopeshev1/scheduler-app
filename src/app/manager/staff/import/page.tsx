import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, makeInviteToken } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { headers } from "next/headers";
import { AppHeader } from "@/components/AppHeader";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, greeting, paragraph, signoff } from "@/lib/email-html";
import { StaffImportClient } from "@/components/StaffImportClient";

/**
 * Bulk staff importer. Owner (or any manager with canAccessStaff)
 * uploads a CSV/XLSX, previews what will be created, fixes errors
 * inline, and commits the whole batch in one go. Unknown roles are
 * added to the company catalog automatically (same as the one-at-a-
 * time Add flow). Invites are NOT auto-sent; after commit we show a
 * "Send invite emails to all imported staff" button so the owner
 * doesn't accidentally blast 500 people the moment they click Import.
 *
 * Row shape expected by importStaffAction (produced client-side after
 * the user has validated + confirmed the preview table):
 *   { firstName, lastName, email, phone, city,
 *     primaryRole, rate, rateType, additionalRoles[], locations[],
 *     canDriveVan }
 */

type ImportRow = {
  firstName: string;
  lastName: string;
  email: string;
  primaryRole: string;
  rate: number;
  rateType: "hourly" | "flat";
  // Extra roles for staffers who appeared in the source file multiple
  // times (Square's "one row per job" shape). Merged client-side in
  // mergeMultiRole() before the payload gets here.
  additionalRoles: { role: string; rate: number; rateType: "hourly" | "flat" }[];
};

type ImportResult = {
  email: string;
  status: "created" | "resurrected" | "skipped" | "failed";
  reason?: string;
  inviteToken?: string;
};

async function importStaffAction(formData: FormData): Promise<void> {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!me || (!me.isOwner && !me.canAccessStaff)) throw new Error("Forbidden");

  const rowsJson = String(formData.get("rows") ?? "[]");
  let rows: ImportRow[] = [];
  try {
    const parsed = JSON.parse(rowsJson);
    if (Array.isArray(parsed)) rows = parsed as ImportRow[];
  } catch {
    redirect("/manager/staff/import?err=" + encodeURIComponent("Couldn't parse the uploaded rows. Try again."));
  }
  if (rows.length === 0) {
    redirect("/manager/staff/import?err=" + encodeURIComponent("No rows to import."));
  }

  // Preload company-scoped data once so each row doesn't re-query.
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const companyName = company?.name ?? "Scheduler";
  const existingUsers = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.companyId, session.companyId));
  const usersByEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));

  const roleCatalog = await db.select().from(schema.roles).where(eq(schema.roles.companyId, session.companyId));
  const roleNames = new Map(roleCatalog.map((r) => [r.name.toLowerCase(), r]));
  let nextRoleOrder = roleCatalog.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);

  // Importer auto-assigns every location the current manager can access
  // (owners = all company locations, non-owners = their own). Managers
  // refine per-staffer later on the staff detail page; keeping this
  // automatic avoids forcing them to type location names for every row.
  const companyLocations = await db
    .select()
    .from(schema.locations)
    .where(eq(schema.locations.companyId, session.companyId));
  const activeLocations = companyLocations.filter((l) => !l.archivedAt);
  let assignableLocationIds: string[];
  if (me.isOwner) {
    assignableLocationIds = activeLocations.map((l) => l.id);
  } else {
    const myLocs = await db
      .select({ id: schema.userLocations.locationId })
      .from(schema.userLocations)
      .where(eq(schema.userLocations.userId, session.userId));
    const mine = new Set(myLocs.map((r) => r.id));
    assignableLocationIds = activeLocations.filter((l) => mine.has(l.id)).map((l) => l.id);
  }
  if (assignableLocationIds.length === 0) {
    redirect("/manager/staff/import?err=" + encodeURIComponent("You don't have access to any locations. Add one in Settings first."));
  }

  const results: ImportResult[] = [];
  const createdForInvite: { userId: string; email: string; firstName: string; inviteToken: string }[] = [];

  for (const r of rows) {
    const email = r.email.toLowerCase().trim();
    try {
      const existing = usersByEmail.get(email);
      const activePrior = existing && !existing.archivedAt ? existing : null;
      const archivedPrior = existing && existing.archivedAt && existing.role === "staff" ? existing : null;

      if (activePrior) {
        results.push({ email, status: "skipped", reason: "Email already active in this company" });
        continue;
      }

      // Resolve all roles (primary + any additionals merged in from
      // multi-row-same-email) - auto-add each to the company catalog
      // when it's one we haven't seen yet.
      const allRoles = [
        { role: r.primaryRole, rate: r.rate, rateType: r.rateType },
        ...(r.additionalRoles ?? []),
      ];
      for (const rr of allRoles) {
        const key = rr.role.toLowerCase();
        if (roleNames.has(key)) continue;
        nextRoleOrder += 10;
        const newRow = {
          id: nanoid(),
          companyId: session.companyId,
          name: rr.role,
          sortOrder: nextRoleOrder,
        };
        await db.insert(schema.roles).values(newRow);
        roleNames.set(key, newRow as (typeof roleCatalog)[number]);
      }

      // Create or resurrect the user row.
      const userId = archivedPrior ? archivedPrior.id : nanoid();
      const inviteToken = makeInviteToken();
      if (archivedPrior) {
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

      // Profile row. Phone, city, DOB, emergency contact, uniform,
      // photo, SMS opt-in - all left for the staffer to fill in during
      // their own onboarding.
      const existingProfile = archivedPrior
        ? await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, userId))
        : [];
      const profileFields = {
        firstName: r.firstName,
        lastName: r.lastName,
        position: r.primaryRole,
        defaultRate: r.rate,
        defaultRateType: r.rateType,
        reminderDayBeforeHour: 9,
      } as const;
      if (existingProfile.length > 0) {
        await db
          .update(schema.staffProfiles)
          .set({
            ...profileFields,
            phone: null,
            city: null,
            dateOfBirth: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            uniformSize: null,
            photoUrl: null,
            reminderMorningOfHour: null,
          })
          .where(eq(schema.staffProfiles.userId, userId));
      } else {
        await db.insert(schema.staffProfiles).values({ userId, ...profileFields });
      }

      // All roles (primary + merged extras from multi-row-same-email).
      // Dedupe by role name case-insensitively so duplicates in the
      // source file don't double-insert.
      if (archivedPrior) {
        await db.delete(schema.staffRoles).where(eq(schema.staffRoles.userId, userId));
      }
      const seenRoles = new Set<string>();
      for (const rr of allRoles) {
        const k = rr.role.toLowerCase();
        if (seenRoles.has(k)) continue;
        seenRoles.add(k);
        await db.insert(schema.staffRoles).values({
          id: nanoid(),
          userId,
          role: rr.role,
          rate: rr.rate,
          rateType: rr.rateType,
        });
      }

      // Locations: auto-assign every location the importing manager can
      // access. Manager refines per-staffer on the staff detail page.
      if (archivedPrior) {
        await db.delete(schema.userLocations).where(eq(schema.userLocations.userId, userId));
      }
      for (const locId of assignableLocationIds) {
        await db.insert(schema.userLocations).values({ userId, locationId: locId });
      }

      // Register in the usersByEmail map so a duplicate email further
      // down in the same batch gets skipped as "already active".
      usersByEmail.set(email, {
        ...(archivedPrior ?? ({} as (typeof existingUsers)[number])),
        id: userId,
        email,
        companyId: session.companyId,
        role: "staff",
        archivedAt: null,
        inviteToken,
      } as (typeof existingUsers)[number]);

      results.push({ email, status: archivedPrior ? "resurrected" : "created", inviteToken });
      createdForInvite.push({ userId, email, firstName: r.firstName, inviteToken });
    } catch (err) {
      results.push({ email, status: "failed", reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Optional: fire invite emails right after the commit if the manager
  // asked for it on the form. Default is off; they can hit "send invites"
  // from the staff list afterward.
  const sendInvitesNow = String(formData.get("sendInvitesNow") ?? "") === "on";
  if (sendInvitesNow && createdForInvite.length > 0) {
    const h = headers();
    const host = h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "https";
    for (const c of createdForInvite) {
      const inviteUrl = `${proto}://${host}/invite/${c.inviteToken}`;
      await sendEmail({
        to: c.email,
        companyId: session.companyId,
        userId: c.userId,
        subject: `Welcome to ${companyName} - finish setting up your account`,
        body:
          `Hi ${c.firstName},\n\n` +
          `Your manager at ${companyName} added you to the staffing roster. ` +
          `Click the link below to finish setting up your account (pick a password, ` +
          `add your phone + emergency contact):\n\n` +
          `${inviteUrl}\n\n` +
          `This link is personal to you - don't share it.\n\n` +
          `- ${companyName}`,
        html: shellWrap(
          [
            greeting(c.firstName, `Your manager at ${companyName} added you to the staffing roster. Click below to finish setting up your account.`),
            `<p style="margin:0 0 20px;"><a href="${inviteUrl}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Finish setting up my account</a></p>`,
            paragraph(`Or paste this link into your browser: ${inviteUrl}`, { muted: true }),
            paragraph(`This link is personal to you — please don't share it.`, { muted: true }),
            signoff(companyName),
          ].join("\n"),
        ),
      });
    }
  }

  const summary = {
    created: results.filter((r) => r.status === "created").length,
    resurrected: results.filter((r) => r.status === "resurrected").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    sent: sendInvitesNow ? createdForInvite.length : 0,
  };
  const failuresEncoded = encodeURIComponent(
    JSON.stringify(results.filter((r) => r.status === "failed" || r.status === "skipped")),
  );
  redirect(
    `/manager/staff/import?done=1&created=${summary.created}&resurrected=${summary.resurrected}` +
      `&skipped=${summary.skipped}&failed=${summary.failed}&sent=${summary.sent}&issues=${failuresEncoded}`,
  );
}

export default async function BulkImportPage({
  searchParams,
}: {
  searchParams: {
    err?: string;
    done?: string;
    created?: string;
    resurrected?: string;
    skipped?: string;
    failed?: string;
    sent?: string;
    issues?: string;
  };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  if (!user.isOwner && !user.canAccessStaff) redirect("/manager?denied=staff");
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));

  const roles = await db.select().from(schema.roles).where(eq(schema.roles.companyId, session.companyId));
  const roleNames = roles.map((r) => r.name).sort((a, b) => a.localeCompare(b));
  // Existing staff emails for client-side duplicate detection in the
  // preview. Case-insensitive.
  const existingEmails = (
    await db.select({ email: schema.users.email, archivedAt: schema.users.archivedAt })
      .from(schema.users)
      .where(and(eq(schema.users.companyId, session.companyId), inArray(schema.users.role, ["staff"])))
  )
    .filter((u) => !u.archivedAt)
    .map((u) => u.email.toLowerCase());

  let issues: { email: string; status: string; reason?: string }[] = [];
  if (searchParams.issues) {
    try {
      issues = JSON.parse(decodeURIComponent(searchParams.issues));
    } catch {
      issues = [];
    }
  }

  return (
    <div>
      <AppHeader
        companyName={company?.name ?? ""}
        userEmail={user.email}
        role="manager"
        logoUrl={company?.logoUrl}
        isOwner={!!user.isOwner}
        canAccessCalendar={!!user.canAccessCalendar}
        canAccessStaff={!!user.canAccessStaff}
        canAccessLog={!!user.canAccessLog}
        canAccessTeam={!!user.canAccessTeam}
        canEditSettings={!!user.canEditSettings}
      />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link href="/manager/staff" className="text-sm text-gray-500 hover:underline">← Back to staff</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-2">Import staff in bulk</h1>
        <p className="text-sm text-gray-600 mb-6">
          Download the template, fill it in (or paste from a spreadsheet of your own with matching
          columns), upload it here, review what will be created, and commit the batch.
          Unknown roles are added to your company&apos;s role catalog automatically.
        </p>

        {searchParams.err && (
          <div className="mb-4 border border-red-300 bg-red-50 text-red-800 text-sm rounded p-3">
            {searchParams.err}
          </div>
        )}

        {searchParams.done === "1" && (
          <div className="mb-4 border border-green-300 bg-green-50 text-green-900 text-sm rounded p-4 space-y-1">
            <p className="font-semibold">Import complete.</p>
            <p>
              Created: <strong>{searchParams.created ?? 0}</strong>
              {Number(searchParams.resurrected ?? 0) > 0 && (
                <> · Resurrected archived: <strong>{searchParams.resurrected}</strong></>
              )}
              {Number(searchParams.skipped ?? 0) > 0 && (
                <> · Skipped (already active): <strong>{searchParams.skipped}</strong></>
              )}
              {Number(searchParams.failed ?? 0) > 0 && (
                <> · Failed: <strong className="text-red-700">{searchParams.failed}</strong></>
              )}
              {Number(searchParams.sent ?? 0) > 0 && (
                <> · Invite emails sent: <strong>{searchParams.sent}</strong></>
              )}
            </p>
            {issues.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm">Show issues ({issues.length})</summary>
                <ul className="mt-2 text-xs space-y-1">
                  {issues.map((it, i) => (
                    <li key={i}>
                      <span className="font-mono">{it.email}</span> — {it.status}
                      {it.reason ? `: ${it.reason}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="pt-2">
              Head to <Link href="/manager/staff" className="underline">the staff list</Link> to send invite emails (if you didn&apos;t
              tick the box to send them now).
            </p>
          </div>
        )}

        <StaffImportClient
          formAction={importStaffAction}
          knownRoleNames={roleNames}
          existingEmails={existingEmails}
        />

        <section className="border rounded-lg bg-white p-6 mt-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-gray-600">
              Need a starting point?{" "}
              <a href="/manager/staff/import/template" className="underline" download>
                Download the CSV template
              </a>.
            </p>
            <p className="text-xs text-gray-500">
              Required: <code>first_name</code>, <code>last_name</code>,{" "}
              <code>email</code>, <code>primary_role</code>, <code>rate</code>,{" "}
              <code>rate_type</code>. Extra columns are ignored.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
