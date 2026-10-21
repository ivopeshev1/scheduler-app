import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "@/lib/auth";

/**
 * Build the "/" redirect from the incoming request's own origin so the
 * logout works on every deploy (Vercel preview, production, localhost)
 * without needing an APP_URL env var. The old fallback was hardcoded
 * to http://localhost:3000, which 500'd any user that logged out on
 * the hosted site.
 */
function homeFor(req: NextRequest): URL {
  return new URL("/", req.nextUrl.origin);
}

export async function POST(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(homeFor(req));
}
export async function GET(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(homeFor(req));
}
