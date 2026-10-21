import Link from "next/link";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function HomePage({ searchParams }: { searchParams: { left?: string; deleted?: string } }) {
  const session = await getSession();
  if (session) {
    if (session.role === "manager") redirect("/manager");
    if (session.role === "staff") redirect("/staff");
  }

  const left = searchParams.left === "1";
  const deleted = searchParams.deleted === "1";

  return (
    <main className="max-w-4xl mx-auto px-6 py-16">
      {left && (
        <div className="mb-10 border border-amber-300 bg-amber-50 rounded p-4 text-sm text-amber-900">
          You&apos;ve left your staffing company. If that was a mistake, reach out to your manager and they can re-add you.
        </div>
      )}
      {deleted && (
        <div className="mb-10 border border-red-300 bg-red-50 rounded p-4 text-sm text-red-900">
          Company deleted. Everything&apos;s wiped. Thanks for using Scheduler — you can create a new company any time.
        </div>
      )}
      <header className="mb-16">
        <h1 className="text-4xl font-semibold tracking-tight">Scheduler</h1>
        <p className="text-gray-600 mt-2">Event staffing, simplified.</p>
      </header>

      <section className="grid md:grid-cols-2 gap-12">
        <div>
          <h2 className="text-xl font-semibold mb-3">For event staffing companies</h2>
          <p className="text-gray-700 leading-relaxed">
            Create events, invite staff, and track confirmations - all in one place.
            Replaces messy spreadsheets and endless group texts.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/signup" className="btn btn-primary">Create your company</Link>
            <Link href="/login" className="btn btn-secondary">Log in</Link>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Owners, managers, and staff all log in from the same place.
          </p>
        </div>

        <div className="border rounded-lg p-6 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">What you get</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            <li>• Monthly calendar view of events</li>
            <li>• Pool + individual staffing modes per position</li>
            <li>• Priority and backup invite tiers</li>
            <li>• Automatic email notifications</li>
            <li>• Staff self-service: accept, reject, block out days</li>
            <li>• Red/black status at a glance</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
