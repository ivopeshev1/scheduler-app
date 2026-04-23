import { redirect } from "next/navigation";
import { db, schema } from "@/db/client";
import { createSession, hashPassword } from "@/lib/auth";
import { nanoid } from "nanoid";
import Link from "next/link";
import { eq } from "drizzle-orm";

async function signupAction(formData: FormData) {
  "use server";
  const companyName = String(formData.get("companyName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!companyName || !email || !password) throw new Error("All fields are required");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");

  const slugBase = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let slug = slugBase || "company";
  let suffix = 1;
  while ((await db.select().from(schema.companies).where(eq(schema.companies.slug, slug))).length > 0) {
    suffix += 1;
    slug = `${slugBase}-${suffix}`;
  }

  const companyId = nanoid();
  await db.insert(schema.companies).values({ id: companyId, name: companyName, slug });

  // Seed the same default role catalog new companies get on /api/setup so
  // Settings → Roles and the event role dropdown are populated on day one.
  const DEFAULT_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"];
  for (let i = 0; i < DEFAULT_ROLES.length; i++) {
    await db.insert(schema.roles).values({
      id: nanoid(),
      companyId,
      name: DEFAULT_ROLES[i],
      sortOrder: i,
    });
  }

  const userId = nanoid();
  await db.insert(schema.users).values({
    id: userId,
    companyId,
    email,
    passwordHash: hashPassword(password),
    role: "manager",
    // Signup user is the company owner - unconditional access to everything
    isOwner: true,
    canEditSettings: true,
    inviteAcceptedAt: new Date(),
  });

  await createSession({ userId, companyId, role: "manager" });
  redirect("/manager");
}

export default function SignupPage() {
  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <Link href="/" className="text-sm text-gray-500 hover:underline">← Back</Link>
      <h1 className="text-3xl font-semibold mt-6">Create your company</h1>
      <p className="text-gray-600 mt-2">You'll be the first manager. You can invite staff later.</p>
      <form action={signupAction} className="mt-8 space-y-4">
        <div><label htmlFor="companyName" className="label">Company name</label><input id="companyName" name="companyName" className="input" placeholder="Flair Projects SB" required /></div>
        <div><label htmlFor="email" className="label">Your email</label><input id="email" name="email" type="email" className="input" placeholder="you@yourcompany.com" required /></div>
        <div><label htmlFor="password" className="label">Password</label><input id="password" name="password" type="password" className="input" minLength={8} placeholder="At least 8 characters" required /></div>
        <button type="submit" className="btn btn-primary w-full justify-center">Create company</button>
      </form>
      <p className="text-sm text-gray-500 mt-6">Already have an account? <Link href="/login" className="underline">Log in</Link></p>
    </main>
  );
}
