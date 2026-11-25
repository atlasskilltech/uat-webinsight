"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { addCcRecipientAction, updateCcRecipientAction, removeCcRecipientAction } from "../forwarding-actions";

export interface CcRecipientView {
  id: string;
  email: string;
}

/**
 * Manage the CC recipients applied to every forwarded invoice. The Finance &
 * Accounts destination stays the primary (To) recipient; these are added as Cc.
 */
export function CcRecipients({ recipients }: { recipients: CcRecipientView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [newEmail, setNewEmail] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");

  function add() {
    const email = newEmail.trim();
    if (!email) return;
    startTransition(async () => {
      const res = await addCcRecipientAction({ email });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        setNewEmail("");
        router.refresh();
      }
    });
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const res = await updateCcRecipientAction({ id, email: editEmail.trim() });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeCcRecipientAction({ id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {recipients.length === 0 ? (
        <p className="text-sm text-muted">No CC recipients yet. Add one below — they&apos;ll be CC&apos;d on every forwarded document.</p>
      ) : (
        <ul className="space-y-2">
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              {editingId === r.id ? (
                <>
                  <input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    type="email"
                    className="h-8 flex-1 rounded-md border border-border bg-surface px-2 text-sm focus-ring"
                    disabled={pending}
                  />
                  <Button size="sm" disabled={pending} onClick={() => saveEdit(r.id)}><Check className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditingId(null)}><X className="h-3.5 w-3.5" /></Button>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate text-sm">{r.email}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => { setEditingId(r.id); setEditEmail(r.email); }}
                    aria-label="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(r.id)} aria-label="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); add(); }}
        className="flex items-center gap-2"
      >
        <input
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          type="email"
          placeholder="cc@yourcompany.com"
          className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring"
          disabled={pending}
        />
        <Button type="submit" size="sm" disabled={pending || !newEmail.trim()}>
          <Plus className="h-3.5 w-3.5" /> Add CC
        </Button>
      </form>
    </div>
  );
}
