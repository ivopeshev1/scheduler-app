import Link from "next/link";

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
};

export function AppHeader({
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
}: Props) {
  const isManager = role === "manager";
  const showCalendar = isManager && (isOwner || canAccessCalendar);
  const showStaff = isManager && (isOwner || canAccessStaff);
  const showLog = isManager && (isOwner || canAccessLog);
  const showTeam = isManager && (isOwner || canAccessTeam);
  const showSettings = isManager && (isOwner || canEditSettings);

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
              {showTeam && (
                <Link href="/manager/team" className="text-gray-700 hover:text-black">Team</Link>
              )}
              {showSettings && (
                <Link href="/manager/settings" className="text-gray-700 hover:text-black">Settings</Link>
              )}
            </>
          )}
          {role === "staff" && (
            <Link href="/staff" className="text-gray-700 hover:text-black">My shifts</Link>
          )}
          <span className="text-gray-500 hidden md:inline">{userEmail}</span>
          <form action="/logout" method="post">
            <button type="submit" className="text-gray-500 hover:text-black">Log out</button>
          </form>
        </nav>
      </div>
    </header>
  );
}
