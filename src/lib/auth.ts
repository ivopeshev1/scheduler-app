import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

const secretKey = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-only-fallback-change-me-please-xxxxxxxxxxxx"
);
const COOKIE_NAME = "scheduler_session";

export type SessionData = {
  userId: string;
  companyId: string;
  role: "manager" | "staff";
};

export async function createSession(data: SessionData) {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const token = await new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .setIssuedAt()
    .sign(secretKey);
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires,
    path: "/",
  });
}

export async function getSession(): Promise<SessionData | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as SessionData;
  } catch {
    return null;
  }
}

export async function clearSession() {
  cookies().delete(COOKIE_NAME);
}

export async function signInWithPassword(email: string, password: string) {
  const result = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const user = result[0];
  if (!user || !user.passwordHash) return { ok: false as const, error: "Invalid email or password" };
  const valid = bcrypt.compareSync(password, user.passwordHash);
  if (!valid) return { ok: false as const, error: "Invalid email or password" };
  // First successful login marks the invite as accepted — the Team page uses this
  // to show "Pending first login" vs. "Active" for managers invited by an owner.
  if (!user.inviteAcceptedAt) {
    await db.update(schema.users).set({ inviteAcceptedAt: new Date() }).where(eq(schema.users.id, user.id));
  }
  await createSession({ userId: user.id, companyId: user.companyId, role: user.role });
  return { ok: true as const, user };
}

export function hashPassword(password: string) {
  return bcrypt.hashSync(password, 10);
}

export function makeInviteToken() {
  return nanoid(32);
}
