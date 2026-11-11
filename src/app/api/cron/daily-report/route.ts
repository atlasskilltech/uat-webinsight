import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { sendDailyStatusReport } from "@/lib/domain-monitor";

/**
 * Daily status-report endpoint. The in-process scheduler (instrumentation.ts)
 * normally sends the digest, but this endpoint lets an external scheduler
 * (cron, Windows Task Scheduler, GitHub Actions) trigger it too. Protected by
 * the same bearer token as the other cron endpoints.
 *
 *   GET/POST /api/cron/daily-report           -> send if due (respects the
 *                                                hour / once-a-day gate)
 *   GET/POST /api/cron/daily-report?force=1   -> send now regardless of gate
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await sendDailyStatusReport({ force });
  return NextResponse.json({ ...result, ranAt: new Date().toISOString() });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
