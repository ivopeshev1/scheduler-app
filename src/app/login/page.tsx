import Link from "next/link";
import { redirect } from "next/navigation";
import { signInWithPassword } from "@/lib/auth";

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const result = await signInWithPassword(email, password);
  if (!result.ok) throw new Error(result.error);
  if (result.user.role === "manager") redirect("/manager");
  if (result.user.role === "staff") redirect("/staff");
}

export default function LoginPage({ searchParams }: { searchParams: { reset?: string } }) {
  const justReset = searchParams.reset === "1";
  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <Link href="/" className="text-sm text-gray-500 hover:underline">← Back</Link>
      <h1 className="text-3xl font-semibold mt-6">Log in</h1>
      {justReset && (
        <div className="mt-6 border border-green-300 bg-green-50 text-green-900 rounded p-3 text-sm">
          Password updated. Sign in with the new one below.
        </div>
      )}
      <form action={loginAction} className="mt-8 space-y-4">
        <div><label htmlFor="email" className="label">Email</label><input id="email" name="email" type="email" className="input" required /></div>
        <div>
          <div className="flex items-end justify-between">
            <label htmlFor="password" className="label">Password</label>
            <Link href="/forgot-password" className="text-xs text-gray-500 hover:underline">Forgot?</Link>
          </div>
          <input id="password" name="password" type="password" className="input" required />
        </div>
        <button type="submit" className="btn btn-primary w-full justify-center">Sign in</button>
      </form>
      <p className="text-sm text-gray-500 mt-6">No account yet? <Link href="/signup" className="underline">Create your company</Link></p>
    </main>
  );
}
