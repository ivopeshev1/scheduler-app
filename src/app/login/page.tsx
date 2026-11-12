import Link from "next/link";
import { redirect } from "next/navigation";
import { signInWithPassword } from "@/lib/auth";
import { PasswordInput } from "@/components/PasswordInput";

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const result = await signInWithPassword(email, password);
  if (!result.ok) {
    // Bounce back to /login with the message in a query param. Throwing
    // here used to kick users to the generic "Application error:
    // a server-side exception has occurred" page, which looks like the
    // app crashed and is terrible UX for something as common as a typo'd
    // password. redirect with an err param lets us render the message
    // inline below the form.
    redirect(`/login?err=${encodeURIComponent(result.error)}`);
  }
  if (result.user.role === "manager") redirect("/manager");
  if (result.user.role === "staff") redirect("/staff");
}

export default function LoginPage({ searchParams }: { searchParams: { reset?: string; err?: string } }) {
  const justReset = searchParams.reset === "1";
  const err = searchParams.err ?? "";
  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <Link href="/" className="text-sm text-gray-500 hover:underline">← Back</Link>
      <h1 className="text-3xl font-semibold mt-6">Log in</h1>
      {justReset && (
        <div className="mt-6 border border-green-300 bg-green-50 text-green-900 rounded p-3 text-sm">
          Password updated. Sign in with the new one below.
        </div>
      )}
      {err && (
        <div className="mt-6 border border-red-300 bg-red-50 text-red-800 rounded p-3 text-sm">
          {err}
        </div>
      )}
      <form action={loginAction} className="mt-8 space-y-4">
        <div><label htmlFor="email" className="label">Email</label><input id="email" name="email" type="email" className="input" required /></div>
        <div>
          <div className="flex items-end justify-between">
            <label htmlFor="password" className="label">Password</label>
            <Link href="/forgot-password" className="text-xs text-gray-500 hover:underline">Forgot?</Link>
          </div>
          <PasswordInput id="password" name="password" required autoComplete="current-password" />
        </div>
        <button type="submit" className="btn btn-primary w-full justify-center">Sign in</button>
      </form>
      <p className="text-sm text-gray-500 mt-6">No account yet? <Link href="/signup" className="underline">Create your company</Link></p>
    </main>
  );
}
