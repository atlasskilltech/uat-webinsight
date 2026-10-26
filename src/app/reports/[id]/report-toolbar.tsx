"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer, Download, Pencil, RefreshCw, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea, Input, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { idleState } from "@/lib/form-state";
import { REPORT_STATUSES } from "@/lib/enums";
import { updateReport, regenerateReport, deleteReport } from "../actions";
import type { ReportData } from "@/lib/report-data";
import { toCsv, downloadCsv } from "@/lib/csv-export";

export function ReportToolbar({
  id,
  title,
  status,
  executiveSummary,
  snapshot,
}: {
  id: string;
  title: string;
  status: string;
  executiveSummary: string;
  snapshot: ReportData;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updateReport, idleState);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Saved.");
      setEditing(false);
      router.refresh();
    } else if (state.status === "error" && state.message) {
      toast(state.message, "error");
    }
  }, [state, toast, router]);

  const exportCsv = () => {
    const sections: string[] = [];
    sections.push("Completed work");
    sections.push(toCsv(["Title", "Category", "Completed", "Summary"], snapshot.work.completed.map((t) => [t.title, t.category, t.completedDate ?? "", t.completionSummary ?? ""])));
    sections.push("\nTop pages (search)");
    sections.push(toCsv(["Page", "Path", "Clicks", "Impressions", "CTR"], snapshot.topPages.map((p) => [p.title, p.path, p.clicks, p.impressions, (p.ctr * 100).toFixed(2) + "%"])));
    sections.push("\nIssues discovered");
    sections.push(toCsv(["Title", "Severity", "Category"], snapshot.issues.discovered.map((i) => [i.title, i.severity, i.category])));
    sections.push("\nOperations");
    sections.push(toCsv(["Date", "System", "Title", "Kind", "Status"], snapshot.operations.map((o) => [o.occurredAt, o.system, o.title, o.kind, o.status])));
    sections.push("\nCompetitor findings");
    sections.push(toCsv(["Organisation", "Observation", "Recommendation", "Category"], snapshot.competitors.map((c) => [c.organisation, c.observation, c.recommendation, c.category])));
    downloadCsv(`${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`, sections.join("\n"));
  };

  return (
    <div className="no-print">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> Print / PDF
        </Button>
        <Button size="sm" variant="secondary" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
          <Pencil className="h-3.5 w-3.5" /> Edit summary
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await regenerateReport(id); toast(r.message ?? "", r.status === "success" ? "success" : "error"); router.refresh(); })}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh figures
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={status === "final" ? "success" : "warning"}>{status === "final" ? "Final" : "Draft"}</Badge>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
            if (!confirm("Delete this report?")) return;
            await deleteReport(id); toast("Report deleted."); router.push("/reports");
          })}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {editing && (
        <form action={action} className="mb-6 rounded-xl border border-border bg-surface p-4">
          <input type="hidden" name="id" value={id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <Input name="title" defaultValue={title} />
            <Select name="status" defaultValue={status} className="sm:w-40">
              <Options options={REPORT_STATUSES} />
            </Select>
          </div>
          <Textarea name="executiveSummary" defaultValue={executiveSummary} className="mt-3 min-h-28" placeholder="Executive summary…" />
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <SubmitButton><Check className="h-4 w-4" /> Save</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
