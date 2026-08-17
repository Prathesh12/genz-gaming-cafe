import { NextResponse, type NextRequest } from "next/server";

import { readSessionToken, SESSION_COOKIE } from "@/lib/session";

/**
 * Edge-of-app guard (Next.js 16 renamed `middleware` to `proxy`).
 *
 * It only answers "is there a valid session cookie?" — authorisation by role
 * is enforced again in every layout and server action, because a proxy check
 * alone is never a security boundary.
 */
/**
 * `/api/logo` is public on purpose: the cafe logo appears on the sign-in
 * screen, which by definition is viewed by someone with no session. Behind the
 * guard it would redirect to /login and never load. It is a logo, not customer
 * data — nothing else is exposed by serving it.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/logo",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.ico",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const userId = token ? await readSessionToken(token) : null;

  if (!userId && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (userId && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  // Baseline hardening. HSTS is added by the host (Vercel) on HTTPS domains.
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static assets.
     */
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|webp|ico|webmanifest)$).*)",
  ],
};
