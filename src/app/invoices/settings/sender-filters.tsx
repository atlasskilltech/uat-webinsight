"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ShieldCheck, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { addSenderFilterAction, removeSenderFilterAction } from "../forwarding-actions";

export interface SenderFilterView {
  id: string;
  pattern: string;
}

/**
 * Manage the per-organisation sender gating for forwarding:
 *   - Allowed senders: only mail from these senders is forwarded. With none
 *     added there is no restriction — every sender is forwarded.
 *   - Excluded senders: mail from these is never forwarded (e.g. a vendor such
 *     as Razorpay), even if it would otherwise be allowed.
 * Each entry is a full email (billing@acme.com) or a domain (acme.com).
 */
export function SenderFilters({
  allow,
  block,
}: {
  allow: SenderFilterView[];
  block: SenderFilterView[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [allowInput, setAllowInput] = useState("");
  const [blockInput, setBlockInput] = useState("");

  function add(kind: "allow" | "block", value: string, reset: () => void) {
    const pattern = value.trim();
    if (!pattern) return;
    startTransition(async () => {
      const res = await addSenderFilterAction({ kind, pattern });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        reset();
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeSenderFilterAction({ id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  const list = (
    items: SenderFilterView[],
    emptyText: string,
  ) =>
    items.length === 0 ? (
      <p className="text-sm text-muted">{emptyText}</p>
    ) : (
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
            <span className="flex-1 truncate text-sm">{r.pattern}</span>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(r.id)} aria-label="Remove">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-6">
      {/* Allowed senders */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-success-soft text-success">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Allowed senders</p>
            <p className="text-xs text-muted">
              Optional. Leave empty to forward mail from any sender (the default). Add entries only to restrict forwarding to
              a specific set — a full address (billing@acme.com) or a whole domain (acme.com). Excluded senders always win.
            </p>
          </div>
        </div>

        {allow.length === 0 && (
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            No allowed senders configured — mail from <strong>any</strong> sender is forwarded (except excluded senders below).
            Add an entry here only if you want to limit forwarding to specific senders.
          </p>
        )}

        {list(allow, "No allowed senders added.")}

        <form onSubmit={(e) => { e.preventDefault(); add("allow", allowInput, () => setAllowInput("")); }} className="flex items-center gap-2">
          <input
            value={allowInput}
            onChange={(e) => setAllowInput(e.target.value)}
            placeholder="billing@vendor.com or vendor.com"
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring"
            disabled={pending}
          />
          <Button type="submit" size="sm" disabled={pending || !allowInput.trim()}>
            <Plus className="h-3.5 w-3.5" /> Allow sender
          </Button>
        </form>
      </div>

      {/* Excluded senders */}
      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <Ban className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">Excluded senders</p>
            <p className="text-xs text-muted">
              Mail from these is never forwarded, even if it is otherwise allowed — e.g. a specific vendor like razorpay.com.
            </p>
          </div>
        </div>

        {list(block, "No excluded senders.")}

        <form onSubmit={(e) => { e.preventDefault(); add("block", blockInput, () => setBlockInput("")); }} className="flex items-center gap-2">
          <input
            value={blockInput}
            onChange={(e) => setBlockInput(e.target.value)}
            placeholder="razorpay.com or noreply@razorpay.com"
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring"
            disabled={pending}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !blockInput.trim()}>
            <Plus className="h-3.5 w-3.5" /> Exclude sender
          </Button>
        </form>
      </div>
    </div>
  );
}
