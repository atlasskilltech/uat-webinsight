"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { setGstinValidationAction } from "../forwarding-actions";

/**
 * Opt-in GSTIN match validation for auto-forwarding (migration 013). OFF by
 * default: auto-forward works without requiring a readable buyer GSTIN on every
 * invoice. When ON, a GST invoice is auto-forwarded only when its extracted buyer
 * GSTIN matches this organization's GSTIN (otherwise it is held for review). A
 * human/agent approval always bypasses the check.
 */
export function GstinValidationToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">GSTIN match validation</span>
            <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "on" : "off"}</Badge>
          </div>
          <p className="mt-1 max-w-xl text-xs text-muted">
            When on, a GST invoice auto-forwards only if its buyer GSTIN matches this organization&apos;s GSTIN;
            otherwise it waits for manual approval. Requires AI extraction and a readable GSTIN on the invoice.
            Leave off (default) to auto-forward invoices without GSTIN matching. A manual approval always sends.
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant={enabled ? "secondary" : "primary"}
        disabled={pending}
        className="shrink-0"
        onClick={() =>
          startTransition(async () => {
            const res = await setGstinValidationAction({ enabled: !enabled });
            toast(res.message, res.ok ? "success" : "error");
            if (res.ok) router.refresh();
          })
        }
      >
        {enabled ? "Turn off GSTIN validation" : "Enable GSTIN validation"}
      </Button>
    </div>
  );
}
