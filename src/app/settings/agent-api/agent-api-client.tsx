"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Trash2,
  ShieldCheck,
  Link2,
  AlertTriangle,
  UserCog,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime, fmtDate } from "@/lib/dates";
import { accessLabel, PRESETS, type ScopeDef } from "@/lib/agent-api/scopes";
import { createKeyAction, revokeKeyAction, idleKeyState } from "./actions";

interface KeyView {
  id: string;
  name: string;
  keyLast4: string;
  scopes: string[];
  requireUser: boolean;
  allowedIps: string | null;
  expiresAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LogView {
  id: number;
  at: string;
  keyName: string | null;
  userEmail: string | null;
  action: string | null;
  status: number;
  agent: string | null;
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function AgentApiClient({
  agentApiUrl,
  scopes,
  keys,
  log,
  loadError = null,
}: {
  agentApiUrl: string;
  scopes: ScopeDef[];
  keys: KeyView[];
  log: LogView[];
  loadError?: string | null;
}) {
  const toast = useToast();
  const [state, formAction] = useActionState(createKeyAction, idleKeyState);
  const [revokeState, revokeAction] = useActionState(revokeKeyAction, idleKeyState);
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<string[]>(PRESETS.read_all.scopes);
  const [revealedKey, setRevealedKey] = useState<{ key: string; name: string } | null>(null);

  useEffect(() => {
    if (state.status === "success" && state.newKey) {
      setRevealedKey({ key: state.newKey, name: state.newKeyName ?? "New key" });
      formRef.current?.reset();
      setSelected(PRESETS.read_all.scopes);
      toast(state.message ?? "Key created.", "success");
    } else if (state.status === "error") {
      toast(state.message ?? "Could not create the key.", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (revokeState.status === "success") toast(revokeState.message ?? "Key revoked.", "success");
    else if (revokeState.status === "error") toast(revokeState.message ?? "Could not revoke the key.", "error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revokeState]);

  const toggleScope = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const activeKeys = keys.filter((k) => !k.revoked);
  const revokedKeys = keys.filter((k) => k.revoked);

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{loadError}</span>
        </div>
      )}
      {/* How it works + the URL to paste into IntelligenceOS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-accent" /> Connect to IntelligenceOS
          </CardTitle>
          <CardDescription>
            In IntelligenceOS → <strong>Connectors → Connect project</strong>, enter a project name, the Agent API URL
            below and a key you generate here. IntelligenceOS reads the key&apos;s manifest and lets its agents (and the
            voice assistant) read whatever the key allows. Keys are read-only and shown only once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field label="Agent API URL (Project URL)">
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground">
                {agentApiUrl}
              </code>
              <CopyButton value={agentApiUrl} label="Copy URL" />
            </div>
          </Field>
        </CardContent>
      </Card>

      {/* One-time reveal of a freshly created key */}
      {revealedKey && (
        <Card className="border-success/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success">
              <ShieldCheck className="h-4 w-4" /> Copy your new key now
            </CardTitle>
            <CardDescription>
              This is the only time <strong>{revealedKey.name}</strong> is shown. Paste it into IntelligenceOS now; if
              you lose it, revoke it and create another.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded-lg border border-success/40 bg-success-soft px-3 py-2 font-mono text-sm text-foreground">
                {revealedKey.key}
              </code>
              <CopyButton value={revealedKey.key} label="Copy key" />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevealedKey(null)}>
              I&apos;ve copied it — hide
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create a key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-accent" /> Generate a new key
          </CardTitle>
          <CardDescription>Choose a name and exactly what this key may read.</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={formRef} action={formAction} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Key name" required hint="So you can recognise it later, e.g. “IntelligenceOS (read only)”.">
                <Input name="name" placeholder="IntelligenceOS (read only)" required maxLength={120} />
              </Field>
              <Field label="Expiry (optional)" hint="Leave blank for no expiry.">
                <Input name="expiresAt" type="date" />
              </Field>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">What can this key read?</span>
                <div className="flex gap-1.5">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(PRESETS.read_all.scopes)}>
                    Select all
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>
                    Clear
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {scopes.map((s) => {
                  const checked = selected.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                        checked ? "border-accent/50 bg-accent-soft/40" : "border-border hover:bg-surface-hover"
                      }`}
                    >
                      <input
                        type="checkbox"
                        name="scopes"
                        value={s.id}
                        checked={checked}
                        onChange={() => toggleScope(s.id)}
                        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{s.label}</span>
                        <span className="block text-xs text-muted-2">{s.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                <input type="checkbox" name="requireUser" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <UserCog className="h-3.5 w-3.5" /> Act as the signed-in user
                  </span>
                  <span className="block text-xs text-muted-2">
                    Every request must name a Web Insight user (their email) and is limited to what that user may see.
                    Tick the matching box in IntelligenceOS too.
                  </span>
                </span>
              </label>
              <Field label="Allowed IPs (optional)" hint="Comma-separated. Restrict to the IntelligenceOS server&apos;s IP. Blank = any.">
                <Input name="allowedIps" placeholder="e.g. 203.0.113.10" />
              </Field>
            </div>

            <SubmitButton pendingLabel="Generating…">
              <KeyRound className="h-4 w-4" /> Generate key
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      {/* Active keys */}
      <Card>
        <CardHeader>
          <CardTitle>Keys</CardTitle>
          <CardDescription>Only a key&apos;s last 4 characters are kept — the full key is never stored.</CardDescription>
        </CardHeader>
        <CardContent>
          {activeKeys.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No keys yet"
              description="Generate a key above to connect IntelligenceOS."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Access</TH>
                  <TH>Key</TH>
                  <TH>Last used</TH>
                  <TH>Expires</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {activeKeys.map((k) => (
                  <TR key={k.id}>
                    <TD>
                      <div className="font-medium text-foreground">{k.name}</div>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {k.requireUser && (
                          <Badge tone="info">
                            <UserCog className="h-3 w-3" /> Acts as user
                          </Badge>
                        )}
                        {k.allowedIps && <Badge tone="neutral">IP-restricted</Badge>}
                      </div>
                    </TD>
                    <TD>
                      <Badge tone="accent">{accessLabel(k.scopes)}</Badge>
                      <div className="pt-1 text-xs text-muted-2">{k.scopes.length} area{k.scopes.length === 1 ? "" : "s"}</div>
                    </TD>
                    <TD>
                      <code className="text-xs text-muted">…{k.keyLast4}</code>
                    </TD>
                    <TD className="text-sm text-muted">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : "Never"}</TD>
                    <TD className="text-sm text-muted">{k.expiresAt ? fmtDate(k.expiresAt) : "—"}</TD>
                    <TD className="text-right">
                      <form action={revokeAction} className="inline">
                        <input type="hidden" name="id" value={k.id} />
                        <SubmitButton variant="danger" size="sm" pendingLabel="Revoking…">
                          <Trash2 className="h-4 w-4" /> Revoke
                        </SubmitButton>
                      </form>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {revokedKeys.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-2">
                <AlertTriangle className="h-3.5 w-3.5" /> Revoked keys
              </div>
              <div className="flex flex-wrap gap-2">
                {revokedKeys.map((k) => (
                  <Badge key={k.id} tone="neutral">
                    {k.name} · …{k.keyLast4}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent requests */}
      <Card>
        <CardHeader>
          <CardTitle>Recent requests</CardTitle>
          <CardDescription>What IntelligenceOS has read through these keys.</CardDescription>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <EmptyState icon={KeyRound} title="No requests yet" description="Activity appears here once IntelligenceOS starts reading." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Key</TH>
                  <TH>Action</TH>
                  <TH>As user</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {log.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-sm text-muted">{fmtDateTime(l.at)}</TD>
                    <TD className="text-sm">{l.keyName ?? "—"}</TD>
                    <TD className="text-sm">{l.action ?? "—"}</TD>
                    <TD className="text-sm text-muted">{l.userEmail ?? "—"}</TD>
                    <TD>
                      <Badge tone={l.status < 300 ? "success" : l.status < 500 ? "warning" : "danger"}>{l.status}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
