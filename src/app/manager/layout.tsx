import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { shouldOnboardManager } from "@/lib/permissions";

/**
 * Shared layout for every /manager/* page. Enforces one rule: a signed-in
 * manager who hasn't filled in their profile gets sent to /manager/onboard
 * before they can see anything else. Everything else is rendered by the
 * page components themselves.
 */
export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "manager") {
    return <>{children}</>; // page itself will redirect to /login
  }

  const h = headers();
  // next/headers exposes the current URL via x-invoke-path (dev) or we fall
  // back to the referer / pathname header. We just need to skip the
  // onboarding redirect when the manager is ALREADY on /manager/onboard,
  // otherwise they'd loop forever.
  const path =
    h.get("x-invoke-path") ??
    h.get("x-pathname") ??
    h.get("next-url") ??
    "";
  if (path.includes("/manager/onboard")) {
    return <>{children}</>;
  }

  const [profile] = await db
    .select({ userId: schema.managerProfiles.userId })
    .from(schema.managerProfiles)
    .where(eq(schema.managerProfiles.userId, session.userId));

  // Owner also has to finish the company-level wizard (company fields set
  // in step 1 + defaults in step 3). Non-owner managers only need their
  // own profile.
  const [me] = await db
    .select({ isOwner: schema.users.isOwner })
    .from(schema.users)
    .where(eq(schema.users.id, session.userId));
  const [company] = await db
    .select({ onboardedAt: schema.companies.onboardedAt })
    .from(schema.companies)
    .where(eq(schema.companies.id, session.companyId));

  if (shouldOnboardManager({ role: "manager" }, !!profile)) {
    redirect("/manager/onboard");
  }
  if (me?.isOwner && !company?.onboardedAt) {
    redirect("/manager/onboard");
  }

  return <>{children}</>;
}
