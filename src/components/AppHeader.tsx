import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { UserMenu } from "@/components/UserMenu";

type Props = {
  companyName: string;
  userEmail: string;
  role: "manager" | "staff";
  logoUrl?: string | null;
  // Owners ignore the per-area flags - they always see every nav item. For
  // non-owner managers, each link is gated on the matching flag, which the
  // owner sets when adding a manager (and can edit later on the Team page).
  isOwner?: boolean;
  canAccessCalendar?: boolean;
  canAccessStaff?: boolean;
  canAccessLog?: boolean;
  canAccessTeam?: boolean;
  canEditSettings?: boolean;
  canAccessPayroll?: boolean;
};

export async function AppHeader({
  companyName,
  userEmail,
  role,
  logoUrl,
  isOwner,
  canAccessCalendar,
  canAccessStaff,
  canAccessLog,
  canAccessTeam,
  canEditSettings,
  canAccessPayroll,
}: Props) {
  // Pull the signed-in user's profile (photo + name) once so the header
  // can show a real avatar + display name instead of email initials.
  // Falls back to the email-derived avatar if no profile exists yet.
  const session = await getSession();
  let avatarUrl: string | null = null;
  let displayName: string | null = null;
  // Freshest permission flags come from the DB — props are the fallback for
  // callers that haven't been updated yet. Pulling here means a new flag
  // like canAccessPayroll just works everywhere without touching every page.
  let liveIsOwner = isOwner;
  let liveCalendar = canAccessCalendar;
  let liveStaff = canAccessStaff;
  let liveLog = canAccessLog;
  let liveTeam = canAccessTeam;
  let liveSettings = canEditSettings;
  let livePayroll = canAccessPayroll;
  if (session) {
    const [u] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId));
    if (u) {
      liveIsOwner = !!u.isOwner;
      liveCalendar = !!u.canAccessCalendar;
      liveStaff = !!u.canAccessStaff;
      liveLog = !!u.canAccessLog;
      liveTeam = !!u.canAccessTeam;
      liveSettings = !!u.canEditSettings;
      livePayroll = !!u.canAccessPayroll;
    }
    if (session.role === "manager") {
      const [p] = await db
        .select({ firstName: schema.managerProfiles.firstName, lastName: schema.managerProfiles.lastName, photoUrl: schema.managerProfiles.photoUrl })
        .from(schema.managerProfiles)
        .where(eq(schema.managerProfiles.userId, session.userId));
      if (p) {
        avatarUrl = p.photoUrl;
        displayName = `${p.firstName} ${p.lastName}`.trim();
      }
    } else if (session.role === "staff") {
      const [p] = await db
        .select({ firstName: schema.staffProfiles.firstName, lastName: schema.staffProfiles.lastName, photoUrl: schema.staffProfiles.photoUrl })
        .from(schema.staffProfiles)
        .where(eq(schema.staffProfiles.userId, session.userId));
      if (p) {
        avatarUrl = p.photoUrl;
        displayName = `${p.firstName} ${p.lastName}`.trim();
      }
    }
  }
  const isManager = role === "manager";
  const showCalendar = isManager && (liveIsOwner || liveCalendar);
  const showStaff = isManager && (liveIsOwner || liveStaff);
  const showLog = isManager && (liveIsOwner || liveLog);
  const showTeam = isManager && (liveIsOwner || liveTeam);
  const showSettings = isManager && (liveIsOwner || liveSettings);
  const showPayroll = isManager && (liveIsOwner || livePayroll);

  return (
    <header className="border-b bg-white sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <Link
          href={isManager ? "/manager" : "/staff"}
          className="font-semibold flex items-center gap-2 shrink-0"
        >
          {logoUrl && (
            // Using a plain <img> rather than next/image so managers can paste
            // any URL without us needing to whitelist domains in next.config.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="h-7 w-7 object-contain rounded"
            />
          )}
          <span>{companyName}</span>
        </Link>

        {showCalendar && (
          <form action="/manager/search" method="get" className="flex-1 max-w-sm">
            <input
              type="search"
              name="q"
              placeholder="Search events by client, venue, date…"
              className="input text-sm py-1.5"
            />
          </form>
        )}

        <nav className="flex items-center gap-5 text-sm shrink-0">
          {isManager && (
            <>
              {showCalendar && (
                <Link href="/manager" className="text-gray-700 hover:text-black">Calendar</Link>
              )}
              {showStaff && (
                <Link href="/manager/staff" className="text-gray-700 hover:text-black">Staff</Link>
              )}
              {showLog && (
                <Link href="/manager/log" className="text-gray-700 hover:text-black">Log</Link>
              )}
              {showPayroll && (
                <Link href="/manager/payroll" className="text-gray-700 hover:text-black">Payroll</Link>
              )}
              {showTeam && (
                <Link href="/manager/team" className="text-gray-700 hover:text-black">Admin</Link>
              )}
            </>
          )}
          {role === "staff" && (
            <>
              <Link href="/staff" className="text-gray-700 hover:text-black">My shifts</Link>
              <Link href="/staff/calendar" className="text-gray-700 hover:text-black">Calendar</Link>
            </>
          )}
          <UserMenu
            displayName={displayName ?? userEmail}
            email={userEmail}
            photoUrl={avatarUrl}
            roleBadge={role === "staff" ? "Staff" : liveIsOwner ? "Owner" : "Manager"}
            profileHref={role === "manager" ? "/manager/onboard" : "/staff/profile"}
            mySettingsHref={role === "manager" ? "/manager/settings/me" : "/staff/settings"}
            companySettingsHref="/manager/settings"
            showCompanySettings={role === "manager" && !!liveIsOwner}
          />
        </nav>
      </div>
    </header>
  );
}

// Avatar + user menu now live in src/components/UserMenu.tsx so the
// dropdown dance can run as a client component without pulling the whole
// header out of the server runtime.
