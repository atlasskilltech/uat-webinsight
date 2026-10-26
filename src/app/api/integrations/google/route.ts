import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { googleConfigured } from "@/lib/integrations";
import { getAuthUrl } from "@/lib/google";
import { getCurrentUser } from "@/lib/auth/session";
import { baseUrl } from "@/lib/base-url";

/** Begin the Google OAuth consent flow (Search Console + Analytics). Admin-only. */
export async function GET(request: Request) {
  const origin = baseUrl(request);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (user.role !== "admin") return new NextResponse("Forbidden — admin access required.", { status: 403 });
  if (!googleConfigured()) {
    return NextResponse.redirect(
      `${origin}/settings?error=${encodeURIComponent("Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.")}`,
    );
  }
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(getAuthUrl(state));
}
