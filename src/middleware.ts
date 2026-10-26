import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware does two things:
 *  1. Injects the request path as `x-pathname` so the root layout can tell
 *     public auth pages apart from protected ones.
 *  2. A cheap UX gate: if there's no session cookie on a protected path, send
 *     the user to /login. This is NOT the authority — real authorization lives
 *     in the root layout (validated session) and in every server action/route
 *     (requireUser / requireAdmin). The cookie here is not validated.
 */

// Auth.js JWT session cookie (http dev vs https prod names).
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
// Paths reachable without a session (prefix match).
const PUBLIC_PREFIXES = ["/login"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIES.some((c) => req.cookies.get(c));
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  if (!isPublic(pathname) && !hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Run on everything except API routes, Next internals and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|ico|csv)$).*)"],
};
