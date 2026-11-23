"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, RefreshCw, RotateCcw, Plug, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { fmtDate } from "@/lib/invoice/format";
import { syncGmailAction, rescanGmailAction, disconnectGmailAction } from "./actions";
import { setAutoForwardAction } from "../forwarding-actions";

export interface GmailAccountView {
  id: string;
  email: string;
  status: string;
  lastError: string | null;
  messageCount: number;
  invoiceCount: number;
  lastSyncAt: string | null;
  consecutiveFailures: number;
  autoForward: boolean;
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  connected: "success",
  reauth_required: "warning",
  error: "danger",
  disconnected: "neutral",
};

export function EmailAccountsClient({
  accounts,
  notice,
}: {
  accounts: GmailAccountView[];
  notice: { type: "success" | "error"; text: string } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (notice) {
      toast(notice.text, notice.type === "success" ? "success" : "error");
      router.replace("/invoices/email-accounts");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.text]);

  function act(action: (p: typeof idleState, fd: FormData) => Promise<typeof idleState>, id: string, okFallback: string) {
    const fd = new FormData();
    fd.set("integrationId", id);
    startTransition(async () => {
      const res = await action(idleState, fd);
      toast(res.message ?? okFallback, res.status === "error" ? "error" : "success");
      if (res.status !== "error") router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Full navigation to the OAuth start route (not a client action). */}
        <a href="/api/invoices/gmail/connect">
          <Button>
            <Plug className="h-4 w-4" /> Connect a Gmail account
          </Button>
        </a>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Mail className="h-8 w-8 text-muted-2" />
            <p className="text-sm font-medium">No Gmail accounts connected</p>
            <p className="max-w-sm text-sm text-muted">Connect a company inbox to start importing invoice emails.</p>
          </CardContent>
        </Card>
      ) : (
        accounts.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-accent" />
                  <span className="truncate font-medium">{a.email}</span>
                  <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status.replace("_", " ")}</Badge>
                  <Badge tone={a.autoForward ? "success" : "neutral"}>
                    Auto-forward {a.autoForward ? "on" : "off"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {a.messageCount} email(s) · {a.invoiceCount} invoice(s) imported ·{" "}
                  {a.lastSyncAt ? `last sync ${fmtDate(a.lastSyncAt)}` : "never synced"}
                </p>
                {a.lastError && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-danger">
                    <AlertTriangle className="h-3 w-3" /> {a.lastError}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {a.status === "reauth_required" || a.status === "disconnected" ? (
                  <a href="/api/invoices/gmail/connect">
                    <Button size="sm" variant="secondary">Reconnect</Button>
                  </a>
                ) : (
                  <Button size="sm" disabled={pending} onClick={() => act(syncGmailAction, a.id, "Synced.")}>
                    <RefreshCw className="h-3.5 w-3.5" /> Sync now
                  </Button>
                )}
                {(a.status === "connected" || a.status === "error") && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    title="Re-check recent mail with the latest invoice detection (catches invoices missed earlier)."
                    onClick={() => act(rescanGmailAction, a.id, "Re-scanned.")}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Rescan inbox
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={a.autoForward ? "secondary" : "primary"}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await setAutoForwardAction({ integrationId: a.id, enabled: !a.autoForward });
                      toast(res.message, res.ok ? "success" : "error");
                      if (res.ok) router.refresh();
                    })
                  }
                >
                  {a.autoForward ? "Turn off auto-forward" : "Enable auto-forward"}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(disconnectGmailAction, a.id, "Disconnected.")}>
                  Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
