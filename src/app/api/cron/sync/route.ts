import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { runGoogleSync, type SyncResult } from "@/lib/sync";
import type { Provider } from "@/lib/integrations";

/**
 * Scheduled daily sync endpoint, triggered by an OS scheduler (Windows Task
 * Scheduler / cron) via scripts/daily-sync.mjs. Protected by a bearer token
 * (CRON_SECRET) that is server-side only and never sent to the browser.
 *
 * Each provider is synced independently so one provider's failure does not
 * block reporting the other's result.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  // Constant-time compare; length guard avoids timingSafeEqual throwing.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<NextResponse> {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured on the server." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const providers: Provider[] = ["gsc", "ga4"];
  const results: SyncResult[] = [];
  for (const p of providers) {
    try {
      results.push(await runGoogleSync(p, { trigger: "cron" }));
    } catch (e) {
      // runGoogleSync handles its own errors; this is a final safety net.
      results.push({ provider: p, ok: false, count: 0, message: e instanceof Error ? e.message : "Sync failed." });
    }
  }

  revalidatePath("/settings");
  revalidatePath("/seo");
  revalidatePath("/");

  const ok = results.every((r) => r.ok || r.skipped);
  return NextResponse.json({ ok, ranAt: new Date().toISOString(), results });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
