import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { runRemindersAll, runRecurringAll, runDueGmailSyncs, runForwardingAll, drainJobs } from "@/lib/invoice/worker/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Automation endpoints for the Invoice Agent, protected by a bearer token
 * (INVOICE_CRON_SECRET, falling back to the app's CRON_SECRET). An external
 * scheduler OR the thin worker loop (scripts/invoice-worker.ts) can call these.
 *
 *   POST /api/invoices/cron/sync       -> Gmail sync for due accounts (+ watch renewal)
 *   POST /api/invoices/cron/forward    -> forward approved invoice emails to Finance & Accounts
 *   POST /api/invoices/cron/reminders  -> due-date reminders (in-app + email)
 *   POST /api/invoices/cron/recurring  -> recurring invoice drafts
 *   POST /api/invoices/cron/drain      -> process a batch of queued jobs
 *   POST /api/invoices/cron/all        -> all of the above, in order
 */
function secret(): string | undefined {
  return process.env.INVOICE_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
}

function authorized(req: Request): boolean {
  const s = secret();
  if (!s) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(req: Request, task: string): Promise<NextResponse> {
  if (!secret()) {
    return NextResponse.json({ ok: false, error: "INVOICE_CRON_SECRET (or CRON_SECRET) is not configured." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const results: unknown[] = [];
    if (task === "sync" || task === "all") results.push(await runDueGmailSyncs());
    if (task === "forward" || task === "all") results.push(await runForwardingAll());
    if (task === "reminders" || task === "all") results.push(await runRemindersAll());
    if (task === "recurring" || task === "all") results.push(await runRecurringAll());
    if (task === "drain" || task === "all") results.push(await drainJobs("cron", 25));
    if (results.length === 0) {
      return NextResponse.json({ ok: false, error: `Unknown task '${task}'.` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Task failed." }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ task: string }> }): Promise<NextResponse> {
  return handle(req, (await ctx.params).task);
}
export async function GET(req: Request, ctx: { params: Promise<{ task: string }> }): Promise<NextResponse> {
  return handle(req, (await ctx.params).task);
}
