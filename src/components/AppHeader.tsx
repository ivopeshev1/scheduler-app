import Link from "next/link";

type Props = { companyName: string; userEmail: string; role: "manager" | "staff" };

export function AppHeader({ companyName, userEmail, role }: Props) {
  return (
    <header className="border-b bg-white sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link href={role === "manager" ? "/manager" : "/staff"} className="font-semibold">{companyName}</Link>
        <nav className="flex items-center gap-6 text-sm">
          {role === "manager" && (<><Link href="/manager" className="text-gray-700 hover:text-black">Calendar</Link><Link href="/manager/staff" className="text-gray-700 hover:text-black">Staff</Link></>)}
          {role === "staff" && (<><Link href="/staff" className="text-gray-700 hover:text-black">My shifts</Link></>)}
          <span className="text-gray-500 hidden md:inline">{userEmail}</span>
          <form action="/logout" method="post"><button type="submit" className="text-gray-500 hover:text-black">Log out</button></form>
        </nav>
      </div>
    </header>
  );
}
