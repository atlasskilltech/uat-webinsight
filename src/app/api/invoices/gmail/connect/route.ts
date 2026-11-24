import { NextResponse } from "next/server";
import { getInvoiceContext } from "@/lib/invoice/org";
import { roleHasCapability } from "@/lib/invoice/types";
import { gmailConfigured, getGmailAuthUrl, makeOAuthState } from "@/lib/invoice/gmail/oauth";
import { baseUrl } from "@/lib/base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start the Gmail OAuth flow: redirect to Google's consent screen. */
export async function GET(req: Request): Promise<Response> {
  // Use the configured PUBLIC base URL (not the internal proxy origin) so the
  // redirect back to the app works in local / UAT / production.
  const base = baseUrl(req);
  const back = (q: string) => NextResponse.redirect(`${base}/invoices/email-accounts?${q}`);

  if (!gmailConfigured()) return back("error=not_configured");

  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId || !ctx.role || !roleHasCapability(ctx.role, "gmail.manage")) {
    return back("error=forbidden");
  }

  const state = makeOAuthState(ctx.organizationId, ctx.user.id);
  return NextResponse.redirect(getGmailAuthUrl(state));
}
