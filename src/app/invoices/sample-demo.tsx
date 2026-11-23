"use client";

import { useState, useTransition } from "react";
import { FlaskConical, Mail, FileCheck2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runSampleInvoiceDemo, type SampleDemoResult } from "./demo-actions";

/**
 * "Try a sample invoice" — runs a bundled sample email through the REAL
 * detection + forwarding-decision + .eml builder so you can see exactly how the
 * agent would handle an incoming invoice. It writes nothing and sends no email.
 */
export function SampleInvoiceDemo() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SampleDemoResult | null>(null);

  function run() {
    startTransition(async () => {
      setResult(await runSampleInvoiceDemo());
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-accent" /> Try a sample invoice
          </span>
          <Button size="sm" variant="secondary" onClick={run} disabled={pending}>
            {pending ? "Running…" : "Run demo"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          See how the agent detects and forwards an invoice — on a bundled sample email, using your real
          settings. Nothing is saved and no email is sent.
        </p>

        {result && !result.ok && (
          <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-danger">{result.error}</p>
        )}

        {result && result.ok && (
          <div className="space-y-3">
            {/* 1. The incoming email */}
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-2">
                <Mail className="h-3.5 w-3.5" /> Incoming email (sample)
              </p>
              <p className="mt-1 truncate text-sm font-medium">{result.sample?.subject}</p>
              <p className="truncate text-xs text-muted">{result.sample?.from}</p>
            </div>

            {/* 2. Detection */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileCheck2 className="h-4 w-4 text-accent" />
              <span>Detected as</span>
              <Badge tone={result.isCandidate ? "success" : "neutral"}>{result.classification}</Badge>
              <span>at</span>
              <Badge tone={(result.confidence ?? 0) >= (result.threshold ?? 70) ? "success" : "warning"}>
                {result.confidence}% confidence
              </Badge>
              <span className="text-muted">(your threshold: {result.threshold}%)</span>
            </div>

            {/* 3. Decision */}
            <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span>{result.decision}</span>
            </p>

            {/* 4. The actual forward (.eml) */}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-2">
                The forward it would send{result.destination ? ` → ${result.destination}` : ""} (original attached as <code>original.eml</code>):
              </p>
              <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
                {result.emlPreview}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
