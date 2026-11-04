import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { runDomainMonitor } from "@/lib/domain-monitor";

/**
 * Domain-monitoring endpoint. The in-process scheduler (instrumentation.ts)
 * normally drives monitoring, but this endpoint lets an external scheduler
 * (cron, Windows Task Scheduler, GitHub Actions) trigger it too. Protected by
 * the same bearer token as the sync endpoint.
 *
 *   GET/POST /api/cron/monitor            -> health-check only
 *   GET/POST /api/cron/monitor?discover=1 -> re-discover subdomains, then check
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handle(req: Request): Promise<NextResponse> {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured on the server." }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const result = await runDomainMonitor();

  revalidatePath("/operations");
  revalidatePath("/");

  return NextResponse.json({ ...result, ranAt: new Date().toISOString() });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
