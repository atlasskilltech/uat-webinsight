import { NextResponse } from "next/server";
import { getInvoiceContext } from "@/lib/invoice/org";
import {
  gmailConfigured,
  verifyOAuthState,
  exchangeGmailCode,
  getGmailAccountEmail,
} from "@/lib/invoice/gmail/oauth";
import { upsertGmailIntegration } from "@/lib/invoice/services/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Gmail OAuth callback: validate state, exchange code, store encrypted tokens. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const base = url.origin;
  const back = (q: string) => NextResponse.redirect(`${base}/invoices/email-accounts?${q}`);

  if (!gmailConfigured()) return back("error=not_configured");

  const err = url.searchParams.get("error");
  if (err) return back(`error=${encodeURIComponent(err)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("error=missing_params");

  const parsed = verifyOAuthState(state);
  if (!parsed) return back("error=bad_state");

  // The signed-in user must match the one who started the flow, and own the org.
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId || ctx.user.id !== parsed.userId || ctx.organizationId !== parsed.organizationId) {
    return back("error=session_mismatch");
  }

  try {
    const tokens = await exchangeGmailCode(code);
    const account = await getGmailAccountEmail(tokens.access_token);
    await upsertGmailIntegration(
      ctx.organizationId,
      { id: ctx.user.id, email: ctx.user.email },
      { email: account.email, googleSub: account.id },
      tokens,
    );
    return back(`connected=${encodeURIComponent(account.email)}`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "connect_failed")}`);
  }
}
