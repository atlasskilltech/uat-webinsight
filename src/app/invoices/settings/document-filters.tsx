"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { addDocumentTypeAction, removeDocumentTypeAction } from "../forwarding-actions";

export interface DocTypeView {
  id: string;
  key: string;
  label: string;
}

/**
 * Per-organisation configurable document types / keywords. Built-in types
 * (invoice, purchase order, statement, other) are recognised automatically and
 * shown read-only. Custom types let an admin add an organisation-specific
 * document type whose LABEL also acts as a keyword matched in incoming email
 * subjects/snippets — no vendor or category is hardcoded.
 */
export function DocumentFilters({ system, custom }: { system: DocTypeView[]; custom: DocTypeView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");

  function add() {
    const v = label.trim();
    if (!v) return;
    startTransition(async () => {
      const res = await addDocumentTypeAction({ label: v });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        setLabel("");
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeDocumentTypeAction({ id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-medium text-muted">Built-in document types (always recognised)</p>
        <div className="flex flex-wrap gap-2">
          {system.length === 0 ? (
            <span className="text-sm text-muted">—</span>
          ) : (
            system.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs text-foreground">
                <Tag className="h-3 w-3 text-muted" /> {s.label}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs font-medium text-muted">
          Custom types &amp; keywords — the label is matched (case-insensitive) in incoming email subjects/snippets.
        </p>
        {custom.length === 0 ? (
          <p className="text-sm text-muted">No custom document types yet.</p>
        ) : (
          <ul className="space-y-2">
            {custom.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <span className="flex-1 truncate text-sm">{c.label} <span className="text-xs text-muted">({c.key})</span></span>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(c.id)} aria-label="Remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Delivery Challan, Payment Advice, Contract"
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring"
            disabled={pending}
          />
          <Button type="submit" size="sm" disabled={pending || !label.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add type
          </Button>
        </form>
      </div>
    </div>
  );
}
