"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, X, Check, FlaskConical, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  addDestinationAction,
  updateDestinationAction,
  deleteDestinationAction,
  addCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  addRuleAction,
  updateRuleAction,
  deleteRuleAction,
  testRulesAction,
} from "../routing-actions";

// --- shared view types (mirror the routing service, client-safe) ------------

export interface DestinationView {
  id: string;
  name: string;
  email: string;
  cc: string[];
  isActive: boolean;
}
export interface CategoryView {
  id: string;
  categoryKey: string;
  label: string;
  isSystem: boolean;
  isActive: boolean;
}
export interface RuleView {
  id: string;
  name: string;
  priority: number;
  matchIntegrationId: string | null;
  matchSender: string | null;
  matchCategoryKey: string | null;
  destinationId: string;
  fallbackDestinationId: string | null;
  autoForward: boolean;
  minConfidence: number | null;
  enabled: boolean;
}
export interface MailboxView {
  id: string;
  email: string;
}

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm focus-ring";
const labelCls = "mb-1 block text-xs font-medium text-muted";

// ============================================================================
// Destinations
// ============================================================================

export function DestinationsManager({ destinations }: { destinations: DestinationView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cc, setCc] = useState("");
  const [isActive, setActive] = useState(true);

  function openNew() {
    setEditing("new"); setName(""); setEmail(""); setCc(""); setActive(true);
  }
  function openEdit(d: DestinationView) {
    setEditing(d.id); setName(d.name); setEmail(d.email); setCc(d.cc.join(", ")); setActive(d.isActive);
  }
  function save() {
    const ccList = cc.split(",").map((s) => s.trim()).filter(Boolean);
    start(async () => {
      const res = editing === "new"
        ? await addDestinationAction({ name: name.trim(), email: email.trim(), cc: ccList })
        : await updateDestinationAction({ id: editing as string, name: name.trim(), email: email.trim(), cc: ccList, isActive });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) { setEditing(null); router.refresh(); }
    });
  }
  function remove(id: string) {
    start(async () => {
      const res = await deleteDestinationAction({ id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {destinations.length === 0 ? (
        <p className="text-sm text-muted">No destinations yet. Add the Finance/AP mailboxes you forward invoices to.</p>
      ) : (
        <ul className="space-y-2">
          {destinations.map((d) => (
            <li key={d.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {d.name} {!d.isActive && <span className="ml-1 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">inactive</span>}
                  </p>
                  <p className="truncate text-xs text-muted">{d.email}{d.cc.length ? ` · cc: ${d.cc.join(", ")}` : ""}</p>
                </div>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => openEdit(d)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(d.id)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Finance & Accounts" disabled={pending} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@company.com" disabled={pending} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>CC (comma-separated, optional)</label>
              <input className={inputCls} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="controller@company.com, audit@company.com" disabled={pending} />
            </div>
            {editing !== "new" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} disabled={pending} /> Active
              </label>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={pending || !name.trim() || !email.trim()} onClick={save}><Check className="h-3.5 w-3.5" /> Save</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /> Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={openNew} disabled={pending}><Plus className="h-3.5 w-3.5" /> Add destination</Button>
      )}
    </div>
  );
}

// ============================================================================
// Categories
// ============================================================================

export function CategoriesManager({ categories }: { categories: CategoryView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");

  function add() {
    if (!label.trim()) return;
    start(async () => {
      const res = await addCategoryAction({ label: label.trim() });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) { setLabel(""); router.refresh(); }
    });
  }
  function remove(id: string) {
    start(async () => {
      const res = await deleteCategoryAction({ id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }
  function toggle(c: CategoryView) {
    start(async () => {
      const res = await updateCategoryAction({ id: c.id, isActive: !c.isActive });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm">
            <span className={c.isActive ? "" : "text-muted line-through"}>{c.label}</span>
            {c.isSystem ? (
              <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">system</span>
            ) : (
              <>
                <button className="text-muted hover:text-foreground" disabled={pending} onClick={() => toggle(c)} aria-label="Toggle active">
                  {c.isActive ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </button>
                <button className="text-muted hover:text-danger" disabled={pending} onClick={() => remove(c.id)} aria-label="Delete"><Trash2 className="h-3 w-3" /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-2">
        <input className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Custom category name" disabled={pending} />
        <Button type="submit" size="sm" disabled={pending || !label.trim()}><Plus className="h-3.5 w-3.5" /> Add</Button>
      </form>
    </div>
  );
}

// ============================================================================
// Rules (+ dry-run test)
// ============================================================================

const emptyRule = (): Omit<RuleView, "id"> => ({
  name: "", priority: 100, matchIntegrationId: null, matchSender: null, matchCategoryKey: null,
  destinationId: "", fallbackDestinationId: null, autoForward: false, minConfidence: null, enabled: true,
});

export function RulesManager({
  rules, destinations, categories, mailboxes,
}: {
  rules: RuleView[];
  destinations: DestinationView[];
  categories: CategoryView[];
  mailboxes: MailboxView[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Omit<RuleView, "id">>(emptyRule());

  const destName = (id: string | null) => destinations.find((d) => d.id === id)?.name ?? (id ? "(removed)" : "—");
  const catLabel = (key: string | null) => (key ? categories.find((c) => c.categoryKey === key)?.label ?? key : "Any");
  const mbxLabel = (id: string | null) => (id ? mailboxes.find((m) => m.id === id)?.email ?? "(removed)" : "Any");

  function openNew() { setEditing("new"); setDraft({ ...emptyRule(), destinationId: destinations[0]?.id ?? "" }); }
  function openEdit(r: RuleView) {
    setEditing(r.id);
    setDraft({
      name: r.name, priority: r.priority, matchIntegrationId: r.matchIntegrationId,
      matchSender: r.matchSender, matchCategoryKey: r.matchCategoryKey, destinationId: r.destinationId,
      fallbackDestinationId: r.fallbackDestinationId, autoForward: r.autoForward,
      minConfidence: r.minConfidence, enabled: r.enabled,
    });
  }
  function set<K extends keyof Omit<RuleView, "id">>(k: K, v: Omit<RuleView, "id">[K]) { setDraft((d) => ({ ...d, [k]: v })); }

  function save() {
    const payload = {
      ...draft,
      name: draft.name.trim(),
      matchSender: draft.matchSender?.trim() || null,
    };
    start(async () => {
      const res = editing === "new"
        ? await addRuleAction(payload)
        : await updateRuleAction({ id: editing as string, ...payload });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) { setEditing(null); router.refresh(); }
    });
  }
  function remove(id: string) {
    start(async () => {
      const res = await deleteRuleAction({ id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  const canSave = draft.name.trim().length >= 2 && draft.destinationId;

  return (
    <div className="space-y-4">
      {rules.length === 0 ? (
        <p className="text-sm text-muted">
          No rules yet. Without rules, invoices forward to the default destination below (existing behaviour). Add a rule to
          route by mailbox, sender or document category.
        </p>
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded bg-surface px-1.5 text-xs font-semibold text-muted">{r.priority}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.name}
                    {!r.enabled && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">disabled</span>}
                    {r.autoForward && <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-[10px] text-success">auto</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted">
                    <span>Mailbox: {mbxLabel(r.matchIntegrationId)}</span>·
                    <span>Sender: {r.matchSender || "Any"}</span>·
                    <span>Category: {catLabel(r.matchCategoryKey)}</span>
                    <ArrowRight className="h-3 w-3" />
                    <span className="font-medium text-foreground">{destName(r.destinationId)}</span>
                    {r.fallbackDestinationId && <span>(fallback: {destName(r.fallbackDestinationId)})</span>}
                    {r.minConfidence !== null && <span>· min {r.minConfidence}%</span>}
                  </p>
                </div>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => openEdit(r)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(r.id)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Rule name</label>
              <input className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Route Acme POs to procurement" disabled={pending} />
            </div>
            <div>
              <label className={labelCls}>Priority (lower wins)</label>
              <input className={inputCls} type="number" value={draft.priority} onChange={(e) => set("priority", Number(e.target.value))} disabled={pending} />
            </div>
            <div>
              <label className={labelCls}>Match mailbox</label>
              <select className={inputCls} value={draft.matchIntegrationId ?? ""} onChange={(e) => set("matchIntegrationId", e.target.value || null)} disabled={pending}>
                <option value="">Any mailbox</option>
                {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Match document category</label>
              <select className={inputCls} value={draft.matchCategoryKey ?? ""} onChange={(e) => set("matchCategoryKey", e.target.value || null)} disabled={pending}>
                <option value="">Any category</option>
                {categories.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.categoryKey}>{c.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Match sender contains (optional)</label>
              <input className={inputCls} value={draft.matchSender ?? ""} onChange={(e) => set("matchSender", e.target.value)} placeholder="billing@acme.com or acme.com" disabled={pending} />
            </div>
            <div>
              <label className={labelCls}>Destination</label>
              <select className={inputCls} value={draft.destinationId} onChange={(e) => set("destinationId", e.target.value)} disabled={pending}>
                <option value="" disabled>Choose…</option>
                {destinations.map((d) => <option key={d.id} value={d.id} disabled={!d.isActive}>{d.name}{!d.isActive ? " (inactive)" : ""}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Fallback destination (optional)</label>
              <select className={inputCls} value={draft.fallbackDestinationId ?? ""} onChange={(e) => set("fallbackDestinationId", e.target.value || null)} disabled={pending}>
                <option value="">None</option>
                {destinations.filter((d) => d.id !== draft.destinationId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Min confidence % (blank = inherit default)</label>
              <input className={inputCls} type="number" min={0} max={100} value={draft.minConfidence ?? ""} onChange={(e) => set("minConfidence", e.target.value === "" ? null : Number(e.target.value))} placeholder="inherit" disabled={pending} />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.autoForward} onChange={(e) => set("autoForward", e.target.checked)} disabled={pending} /> Auto-forward</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} disabled={pending} /> Enabled</label>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={pending || !canSave} onClick={save}><Check className="h-3.5 w-3.5" /> Save rule</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /> Cancel</Button>
          </div>
          {draft.autoForward && (
            <p className="mt-2 text-xs text-warning">Auto-forward sends matching invoices without review once confidence ≥ the threshold. Use the test below first.</p>
          )}
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={openNew} disabled={pending || destinations.length === 0}><Plus className="h-3.5 w-3.5" /> Add rule</Button>
      )}
      {destinations.length === 0 && !editing && (
        <p className="text-xs text-muted">Add at least one destination above before creating a rule.</p>
      )}

      <RuleTester categories={categories} mailboxes={mailboxes} />
    </div>
  );
}

// --- Dry-run tester ---------------------------------------------------------

function RuleTester({ categories, mailboxes }: { categories: CategoryView[]; mailboxes: MailboxView[] }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [integrationId, setIntegrationId] = useState("");
  const [sender, setSender] = useState("");
  const [categoryKey, setCategoryKey] = useState("invoice");
  const [confidence, setConfidence] = useState(90);
  const [mailboxAuto, setMailboxAuto] = useState(false);
  const [result, setResult] = useState<null | {
    destination: string | null; source: string; wouldAction: string; explanation: string; cc: string[];
    minConfidence: number; matchedRuleId: string | null;
  }>(null);

  function run() {
    if (!integrationId) { toast("Pick a mailbox to test.", "error"); return; }
    start(async () => {
      const res = await testRulesAction({ integrationId, sender: sender.trim(), categoryKey, confidencePct: confidence, mailboxAutoForward: mailboxAuto });
      if (!res.ok || !res.result) { toast(res.message, "error"); return; }
      setResult(res.result);
    });
  }

  const actionLabel: Record<string, string> = {
    auto_forward: "Auto-forward (no review)",
    queue_for_approval: "Queue for approval",
    hold_for_review: "Hold for review (below confidence)",
    no_forward: "Not forwarded",
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><FlaskConical className="h-4 w-4 text-accent" /> Test rules (dry run — nothing is sent)</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Mailbox</label>
          <select className={inputCls} value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} disabled={pending}>
            <option value="">Choose…</option>
            {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Document category</label>
          <select className={inputCls} value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} disabled={pending}>
            {categories.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.categoryKey}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Sender</label>
          <input className={inputCls} value={sender} onChange={(e) => setSender(e.target.value)} placeholder="billing@acme.com" disabled={pending} />
        </div>
        <div>
          <label className={labelCls}>Confidence %</label>
          <input className={inputCls} type="number" min={0} max={100} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} disabled={pending} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mailboxAuto} onChange={(e) => setMailboxAuto(e.target.checked)} disabled={pending} />
          Mailbox auto-forward on (affects the default path only)
        </label>
      </div>
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={run} disabled={pending}><FlaskConical className="h-3.5 w-3.5" /> Evaluate</Button>
      </div>
      {result && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <p><span className="text-muted">Would:</span> <span className="font-medium">{actionLabel[result.wouldAction] ?? result.wouldAction}</span></p>
          <p><span className="text-muted">Destination:</span> {result.destination ?? "— (none)"} {result.cc.length ? <span className="text-muted">· cc: {result.cc.join(", ")}</span> : null}</p>
          <p><span className="text-muted">Matched by:</span> {result.source}{result.matchedRuleId ? ` (rule ${result.matchedRuleId.slice(0, 8)}…)` : ""} · min confidence {result.minConfidence}%</p>
          <p className="mt-1 text-xs text-muted">{result.explanation}</p>
        </div>
      )}
    </div>
  );
}
