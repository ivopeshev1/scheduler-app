import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Minimal middleware: pass the current pathname to layouts/pages via a
 * custom header so the manager layout can detect whether it's already
 * on /manager/onboard (and skip the onboarding redirect to avoid a loop).
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("x-pathname", request.nextUrl.pathname);
  // Also expose on the request so downstream server components reading
  // headers() can see it.
  request.headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: request.headers } });
}

export const config = {
  matcher: "/manager/:path*",
};
