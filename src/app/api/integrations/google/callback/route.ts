import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { execute, json } from "@/lib/db";
import { createId } from "@/lib/id";
import { exchangeCode } from "@/lib/google";
import { recordError } from "@/lib/integrations";
import { getCurrentUser } from "@/lib/auth/session";
import { baseUrl } from "@/lib/base-url";

/**
 * OAuth callback. Exchanges the authorization code for tokens and stores them
 * (server-side only) against both the GSC and GA4 integration rows. The user
 * then selects the specific property in Settings before syncing.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = baseUrl(request);

  // Admin-only: only an admin can complete the data-integration connection.
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (user.role !== "admin") return new NextResponse("Forbidden — admin access required.", { status: 403 });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get("google_oauth_state")?.value;
  jar.delete("google_oauth_state");

  if (error) {
    return NextResponse.redirect(`${origin}/settings?error=${encodeURIComponent(`Google authorisation was cancelled (${error}).`)}`);
  }
  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(`${origin}/settings?error=${encodeURIComponent("Invalid OAuth state. Please try connecting again.")}`);
  }

  try {
    const tokens = await exchangeCode(code);
    const configJson = json({ tokens });
    for (const provider of ["gsc", "ga4"]) {
      await execute(
        "INSERT INTO `Integration` (`id`,`provider`,`status`,`config`,`lastError`) VALUES (?,?, 'connected', ?, NULL) " +
          "ON DUPLICATE KEY UPDATE `status`='connected', `config`=VALUES(`config`), `lastError`=NULL",
        [createId(), provider, configJson],
      );
    }
    return NextResponse.redirect(`${origin}/settings?connected=google`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Token exchange failed.";
    await recordError("gsc", message);
    await recordError("ga4", message);
    return NextResponse.redirect(`${origin}/settings?error=${encodeURIComponent(message)}`);
  }
}
