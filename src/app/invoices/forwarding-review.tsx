"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Send, Check, X, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { approveForwardAction, rejectForwardAction } from "./forwarding-actions";

export interface ForwardView {
  id: string;
  subject: string;
  from: string;
  account: string;
  destination: string;
  confidence: number | null;
  status: string;
  error: string | null;
}

const TONE: Record<string, "neutral" | "warning" | "success" | "danger" | "info"> = {
  pending: "warning",
  review: "warning",
  approved: "info",
  sending: "info",
  forwarded: "success",
  failed: "danger",
  skipped: "neutral",
};

// Friendlier labels for the in-flight auto-forward states so they read clearly in
// "Recent forwards" (an auto-forward passes through approved → sending → forwarded).
const STATUS_LABEL: Record<string, string> = {
  approved: "queued to send",
  sending: "sending…",
};

export function ForwardingReview({
  needsAttention,
  recent,
  canApprove,
}: {
  needsAttention: ForwardView[];
  recent: ForwardView[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [list, setList] = useState(needsAttention);

  function act(kind: "approve" | "reject", id: string) {
    startTransition(async () => {
      const res = kind === "approve" ? await approveForwardAction({ forwardId: id }) : await rejectForwardAction({ forwardId: id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        setList((l) => l.filter((x) => x.id !== id));
        router.refresh();
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" /> Needs your approval ({list.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {list.length === 0 ? (
            <p className="text-sm text-muted">Nothing waiting. Invoices are forwarded automatically on accounts where you enabled auto-forward.</p>
          ) : (
            list.map((f) => (
              <div key={f.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.subject || "(no subject)"}</p>
                    <p className="truncate text-xs text-muted">{f.from} · via {f.account}</p>
                  </div>
                  <Badge tone={f.confidence != null && f.confidence >= 70 ? "success" : "warning"}>
                    {f.confidence != null ? `${f.confidence}%` : "—"}
                  </Badge>
                </div>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-2"><Mail className="h-3 w-3" /> → {f.destination}</p>
                {f.error && (
                  <p className="mt-1 rounded bg-warning-soft px-2 py-1 text-xs text-warning">{f.error}</p>
                )}
                {canApprove && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => act("approve", f.id)}>
                      <Send className="h-3.5 w-3.5" /> Forward now
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("reject", f.id)}>
                      <X className="h-3.5 w-3.5" /> Not an invoice
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent forwards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 ? (
            <p className="text-sm text-muted">No forwards yet.</p>
          ) : (
            recent.map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm">{f.subject || "(no subject)"}</p>
                  <p className="truncate text-xs text-muted">→ {f.destination}{f.error ? ` · ${f.error}` : ""}</p>
                </div>
                <Badge tone={TONE[f.status] ?? "neutral"}>
                  {f.status === "forwarded" ? <Check className="mr-1 h-3 w-3" /> : null}
                  {STATUS_LABEL[f.status] ?? f.status}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
