import type { Metadata } from "next";
import { Bot, ScanLine, FileText, Info } from "lucide-react";
import { getInvoiceContext } from "@/lib/invoice/org";
import { listRecentJobs, jobCounts } from "@/lib/invoice/jobs";
import { aiConfigured } from "@/lib/invoice/ai/extract";
import { ocrConfigured } from "@/lib/invoice/ai/ocr";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/invoice/format";
import { NotReady } from "../not-ready";
import { UploadClient } from "./upload-client";

export const metadata: Metadata = { title: "Processing Queue" };
export const dynamic = "force-dynamic";

const JOB_TONE: Record<string, "neutral" | "info" | "success" | "danger" | "warning"> = {
  queued: "neutral",
  running: "info",
  succeeded: "success",
  failed: "warning",
  dead: "danger",
};

export default async function ProcessingPage() {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Processing Queue" canSetup={ctx?.canSetup} />;

  const [jobs, counts] = await Promise.all([
    listRecentJobs(ctx.organizationId),
    jobCounts(ctx.organizationId),
  ]);
  const ai = aiConfigured();
  const ocr = ocrConfigured();

  return (
    <div>
      <PageHeader
        title="AI Processing Queue"
        description="Upload supplier invoices (PDF or image). The pipeline stores the original, extracts text, extracts fields with AI, recomputes totals deterministically, checks for duplicates and routes uncertain results to review."
      />

      {/* Honest capability banner */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone="info" dot><FileText className="mr-1 h-3.5 w-3.5" /> PDF text extraction: always on</Badge>
        <Badge tone={ai ? "success" : "neutral"} dot>
          <Bot className="mr-1 h-3.5 w-3.5" /> AI extraction: {ai ? "configured" : "not configured"}
        </Badge>
        <Badge tone={ocr ? "success" : "neutral"} dot>
          <ScanLine className="mr-1 h-3.5 w-3.5" /> OCR (scanned docs): {ocr ? "configured" : "not configured"}
        </Badge>
      </div>

      {(!ai || !ocr) && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {!ai && "AI field-extraction is off (set AI_PROVIDER, AI_MODEL, AI_API_KEY in Invoice Settings). "}
            {!ocr && "OCR for scanned documents is off (set OCR_PROVIDER). "}
            Uploads still work: the document is stored and a draft is created for manual review — nothing is faked.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <UploadClient />
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent jobs</CardTitle>
              <div className="flex gap-2 text-xs text-muted">
                {(["queued", "running", "succeeded", "failed", "dead"] as const).map((s) => (
                  <span key={s} className="capitalize">{s}: <b>{counts[s]}</b></span>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {jobs.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No processing jobs yet. Upload a document to begin.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Type</TH>
                      <TH>Status</TH>
                      <TH>Attempts</TH>
                      <TH>Updated</TH>
                      <TH>Error</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {jobs.map((j) => (
                      <TR key={j.id}>
                        <TD className="font-medium">{j.type}</TD>
                        <TD><Badge tone={JOB_TONE[j.status] ?? "neutral"}>{j.status}</Badge></TD>
                        <TD>{j.attempts}/{j.max_attempts}</TD>
                        <TD className="text-muted">{fmtDate(j.updated_at)}</TD>
                        <TD className="max-w-xs truncate text-xs text-danger">{j.last_error ?? ""}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
