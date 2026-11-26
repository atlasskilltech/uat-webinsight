import { NextResponse } from "next/server";
import { handleAgentRequest } from "@/lib/agent-api/handler";

/**
 * ATLAS Agent API endpoint for IntelligenceOS.
 *
 * Base URL to enter in IntelligenceOS → Connectors → Connect project:
 *   https://<this-host>/api/agent-api
 *
 * IntelligenceOS then calls GET <base>/manifest and GET <base><action-path>.
 * All logic (auth, scopes, manifest, routing) lives in src/lib/agent-api/.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(req: Request, ctx: Ctx, method: string): Promise<NextResponse> {
  try {
    const { path } = await ctx.params;
    const result = await handleAgentRequest(req, path ?? [], method);
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Last-resort guard so the API always answers JSON, never an HTML 500.
    return NextResponse.json(
      { error: "The service encountered an unexpected error." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(req: Request, ctx: Ctx): Promise<NextResponse> {
  return handle(req, ctx, "GET");
}

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  return handle(req, ctx, "POST");
}
