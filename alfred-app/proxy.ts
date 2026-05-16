import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js 16+ Proxy using the new proxy pattern.
 * This replaces the deprecated middleware approach.
 *
 * Handles authentication checks and redirects for protected routes.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicPathPrefixes = [
    "/api/auth",
    "/login",
    "/signup",
    "/icon.svg",
    "/skills",
    "/settings",
  ];
  const isPublicPath =
    pathname === "/" || publicPathPrefixes.some((path) => pathname.startsWith(path));

  if (isPublicPath) {
    return NextResponse.next();
  }

  const hasSessionCookie =
    request.cookies.has("better-auth.session_token") ||
    request.cookies.has("__Secure-better-auth.session_token") ||
    request.cookies.has("better-auth-session_token") ||
    request.cookies.has("__Secure-better-auth-session_token");

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
