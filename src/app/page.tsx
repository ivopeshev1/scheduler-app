import Link from "next/link";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getSession();
  if (session) {
    if (session.role === "manager") redirect("/manager");
    if (session.role === "staff") redirect("/staff");
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-16">
      <header className="mb-16">
        <h1 className="text-4xl font-semibold tracking-tight">Scheduler</h1>
        <p className="text-gray-600 mt-2">Event staffing, simplified.</p>
      </header>

      <section className="grid md:grid-cols-2 gap-12">
        <div>
          <h2 className="text-xl font-semibold mb-3">For event staffing companies</h2>
          <p className="text-gray-700 leading-relaxed">
            Create events, invite staff, and track confirmations — all in one place.
            Replaces messy spreadsheets and endless group texts.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/signup" className="btn btn-primary">Create your company</Link>
            <Link href="/login" className="btn btn-secondary">Manager login</Link>
          </div>
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

      <footer className="mt-20 pt-8 border-t text-sm text-gray-500">
        Staff received an invite? <Link href="/login" className="underline">Sign in</Link>
      </footer>
    </main>
  );
}
