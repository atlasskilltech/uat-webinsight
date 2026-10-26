"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SearchCheck } from "lucide-react";
import { runAudit } from "./actions";
import { idleState } from "@/lib/form-state";
import { Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";

export function InspectorForm({ defaultUrl }: { defaultUrl?: string }) {
  const [state, action] = useActionState(runAudit, idleState);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Audit complete.");
      if (state.id) router.push(`/inspector/${state.id}`);
    } else if (state.status === "error" && state.message) {
      toast(state.message, "error");
    }
  }, [state, toast, router]);

  return (
    <form action={action} className="space-y-4">
      <Field label="Page URL to audit" required>
        <Input
          name="url"
          type="url"
          defaultValue={defaultUrl ?? ""}
          placeholder="https://atlasuniversity.edu.in/schools/isdi/blog/…"
          required
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="runPsi" className="h-4 w-4 rounded border-border accent-[var(--accent)]" />
        Also run PageSpeed Insights (Core Web Vitals) — adds ~15–25s.
      </label>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Auditing… (can take ~20s)">
          <SearchCheck className="h-4 w-4" /> Run audit
        </SubmitButton>
      </div>
    </form>
  );
}
