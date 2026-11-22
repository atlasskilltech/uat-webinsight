import { NextResponse } from "next/server";
import { enqueueJob } from "@/lib/invoice/jobs";
import { findConnectedIntegrationByEmail } from "@/lib/invoice/services/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gmail push notification receiver (Google Cloud Pub/Sub push subscription).
 *
 * Secure it by configuring the push subscription's endpoint URL with a secret
 * query token, e.g. `.../api/invoices/gmail/push?token=<secret>`, matching
 * GMAIL_PUBSUB_VERIFICATION_AUDIENCE (or INVOICE_CRON_SECRET). The body is a
 * Pub/Sub envelope whose `message.data` is base64 JSON `{emailAddress, historyId}`.
 *
 * We do minimal, fast work: resolve the account and ENQUEUE a sync job (the
 * worker performs the actual history-based sync). Unknown accounts are acked
 * (200) so Pub/Sub does not retry forever; transient internal errors return 500
 * so Pub/Sub retries. Scheduled pull remains the reconciliation fallback.
 */
function verifyToken(req: Request): boolean {
  const expected = process.env.GMAIL_PUBSUB_VERIFICATION_AUDIENCE?.trim() || process.env.INVOICE_CRON_SECRET?.trim();
  if (!expected) return false;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  // Length-guarded constant-ish compare (tokens are not secrets-in-transit here,
  // but avoid trivially short mismatches).
  return token.length === expected.length && token === expected;
}

export async function POST(req: Request): Promise<Response> {
  if (!verifyToken(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { message?: { data?: string } };
    const dataB64 = body.message?.data;
    if (!dataB64) return NextResponse.json({ ok: true, ignored: "no data" });

    let payload: { emailAddress?: string; historyId?: string | number };
    try {
      payload = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"));
    } catch {
      return NextResponse.json({ ok: true, ignored: "bad data" }); // ack, don't retry garbage
    }

    const email = payload.emailAddress?.toLowerCase();
    if (!email) return NextResponse.json({ ok: true, ignored: "no email" });

    const integration = await findConnectedIntegrationByEmail(email);
    if (!integration) return NextResponse.json({ ok: true, ignored: "unknown account" });

    await enqueueJob({
      type: "gmail_sync",
      organizationId: integration.organization_id,
      payload: { organizationId: integration.organization_id, integrationId: integration.id },
      idempotencyKey: `gmailpush:${integration.id}:${payload.historyId ?? "x"}`,
      priority: 50,
    });
    return NextResponse.json({ ok: true, enqueued: true });
  } catch (e) {
    // Transient — let Pub/Sub retry.
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
