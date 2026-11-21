import { NextResponse } from "next/server";
import { getInvoiceContext } from "@/lib/invoice/org";
import { verifyLocalSignedToken, getStorage } from "@/lib/invoice/storage";
import { iQueryOne } from "@/lib/invoice/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve a privately-stored invoice document. Defence in depth:
 *  1. A short-lived HMAC signed token (generated server-side for the key).
 *  2. An authenticated session whose active organization owns the key.
 * Documents are never public and never served from /public.
 */
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const key = verifyLocalSignedToken(token);
  if (!key) return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });

  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  // Keys are "org/<orgId>/..." — the caller must belong to that organization.
  const m = key.match(/^org\/([^/]+)\//);
  if (!m || m[1] !== ctx.organizationId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const att = await iQueryOne<{ mime_type: string; filename: string }>(
    "SELECT mime_type, filename FROM `invoice_attachments` WHERE organization_id=? AND storage_key=? LIMIT 1",
    [ctx.organizationId, key],
  );

  try {
    const bytes = await getStorage().get(key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": att?.mime_type ?? "application/octet-stream",
        "content-disposition": `inline; filename="${(att?.filename ?? "document").replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
}
