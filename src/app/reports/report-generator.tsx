"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText } from "lucide-react";
import { createReport } from "./actions";
import { idleState } from "@/lib/form-state";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function presetDates(preset: string): { start: string; end: string; title: string; type: string } {
  const now = new Date();
  const day = now.getDay();
  if (preset === "this_week" || preset === "last_week") {
    const mondayOffset = (day + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset - (preset === "last_week" ? 7 : 0));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: iso(monday), end: iso(sunday), title: `Weekly report — ${iso(monday)}`, type: "weekly" };
  }
  if (preset === "this_month" || preset === "last_month") {
    const base = new Date(now.getFullYear(), now.getMonth() - (preset === "last_month" ? 1 : 0), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return { start: iso(base), end: iso(end), title: `Monthly report — ${base.toLocaleString("en-US", { month: "long", year: "numeric" })}`, type: "monthly" };
  }
  return { start: iso(now), end: iso(now), title: "Custom report", type: "custom" };
}

export function ReportGenerator({ autoOpen }: { autoOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [state, action] = useActionState(createReport, idleState);
  const [preset, setPreset] = useState("this_week");
  const [dates, setDates] = useState(() => presetDates("this_week"));
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Generated.");
      setOpen(false);
      if (state.id) router.push(`/reports/${state.id}`);
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
  }, [state, toast, router]);

  const applyPreset = (p: string) => {
    setPreset(p);
    setDates(presetDates(p));
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Generate report
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Generate a report" description="Compiles work, website performance, issues, operations and competitor findings for the chosen period." size="lg">
        <form action={action} className="space-y-4">
          <Field label="Quick period">
            <Select value={preset} onChange={(e) => applyPreset(e.target.value)}>
              <Options options={[
                { value: "this_week", label: "This week" },
                { value: "last_week", label: "Last week" },
                { value: "this_month", label: "This month" },
                { value: "last_month", label: "Last month" },
                { value: "custom", label: "Custom range" },
              ]} />
            </Select>
          </Field>
          <Field label="Report title" required error={state.fieldErrors?.title}>
            <Input name="title" value={dates.title} onChange={(e) => setDates((d) => ({ ...d, title: e.target.value }))} required />
          </Field>
          <input type="hidden" name="type" value={dates.type} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Period start" required error={state.fieldErrors?.periodStart}>
              <Input type="date" name="periodStart" value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} required />
            </Field>
            <Field label="Period end" required error={state.fieldErrors?.periodEnd}>
              <Input type="date" name="periodEnd" value={dates.end} onChange={(e) => setDates((d) => ({ ...d, end: e.target.value }))} required />
            </Field>
          </div>
          <Field label="Executive summary (optional)" hint="You can edit this after generating.">
            <Textarea name="executiveSummary" placeholder="A short narrative summary for management…" />
          </Field>
          <input type="hidden" name="status" value="draft" />
          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <p className="text-xs text-muted-2"><FileText className="mr-1 inline h-3.5 w-3.5" /> Figures are captured as a snapshot at generation time.</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <SubmitButton pendingLabel="Generating…">Generate</SubmitButton>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
