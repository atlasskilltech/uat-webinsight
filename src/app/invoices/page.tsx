import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Database, Cog, Inbox, FileCheck2, Send, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getInvoiceContext } from "@/lib/invoice/org";
import { getInvoiceDbStatus } from "@/lib/invoice/status";
import { listGmailAccounts } from "@/lib/invoice/services/gmail";
import { listForwards, forwardCounts } from "@/lib/invoice/services/forwarding";
import { hasCapability } from "@/lib/invoice/permissions";
import { iQueryOne } from "@/lib/invoice/db";
import { ForwardingReview, type ForwardView } from "./forwarding-review";
import { SampleInvoiceDemo } from "./sample-demo";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Invoice Agent" };
export const dynamic = "force-dynamic";

async function count(sql: string, params: unknown[]): Promise<number> {
  const row = await iQueryOne<{ c: number }>(sql, params);
  return Number(row?.c ?? 0);
}

export default async function InvoiceAgentHome() {
  const ctx = await getInvoiceContext();
  const dbStatus = await getInvoiceDbStatus();

  if (!dbStatus.migrated) {
    return (
      <div>
        <PageHeader title="Invoice Agent" description="A digital Finance & Accounts employee that monitors Gmail and forwards invoices." />
        <EmptyState
          icon={Database}
          title={dbStatus.reachable ? "Invoice database not initialized" : "Invoice database unreachable"}
          description={
            dbStatus.reachable
              ? "A server admin needs to run the migrations: npm run invoice:db:init"
              : `Could not reach the invoice database. Check ATLAS_INVOICE_DB_* settings. ${dbStatus.error ?? ""}`
          }
        />
      </div>
    );
  }

  if (!ctx?.organizationId) {
    return (
      <div>
        <PageHeader title="Invoice Agent" description="A digital Finance & Accounts employee that monitors Gmail and forwards invoices." />
        <EmptyState
          icon={Cog}
          title="Finish setup"
          description="Create your organization to start connecting Gmail accounts and configuring the Finance & Accounts destination."
          action={
            ctx?.canSetup ? (
              <Link href="/invoices/settings"><Button>Go to Agent Settings</Button></Link>
            ) : (
              <span className="text-sm text-muted">Ask a Finance Admin to complete setup.</span>
            )
          }
        />
      </div>
    );
  }

  const org = ctx.organizationId;
  // All counts are INVOICE-only — ordinary emails never increase them.
  const [accounts, candidates, counts, allForwards, canApprove] = await Promise.all([
    listGmailAccounts(org),
    count("SELECT COUNT(*) c FROM `email_messages` WHERE organization_id=? AND is_invoice_candidate=1", [org]),
    forwardCounts(org),
    listForwards(org, { limit: 100 }),
    hasCapability("email.send"),
  ]);
  const connected = accounts.filter((a) => a.status === "connected").length;
  const forwarded = counts.forwarded ?? 0;
  const pendingApprovals = counts.pending ?? 0;
  const needsReview = counts.review ?? 0;

  const toView = (f: (typeof allForwards)[number]): ForwardView => ({
    id: f.id,
    subject: f.subject ?? "",
    from: f.from_address ?? "",
    account: f.account_email ?? "",
    destination: f.destination,
    confidence: f.confidence != null ? Math.round(Number(f.confidence)) : null,
    status: f.status,
    error: f.last_error,
  });
  const needsAttention = allForwards.filter((f) => f.status === "pending" || f.status === "review").map(toView);
  const recent = allForwards.filter((f) => ["forwarded", "failed", "skipped"].includes(f.status)).slice(0, 10).map(toView);

  return (
    <div>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Invoice Agent"
        description={`Monitoring Gmail for ${ctx.organization?.name ?? "your organization"} and forwarding supplier invoices to Finance & Accounts. All figures are invoice-only.`}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Invoice emails detected" value={candidates} icon={FileCheck2} tone="success" state={candidates ? "ok" : "empty"} />
        <StatCard label="Invoices forwarded" value={forwarded} icon={Send} tone="success" state={forwarded ? "ok" : "empty"} />
        <StatCard label="Pending approvals" value={pendingApprovals} icon={Inbox} state={pendingApprovals ? "ok" : "empty"} />
        <StatCard label="Needs review" value={needsReview} icon={AlertTriangle} state={needsReview ? "ok" : "empty"} />
        <StatCard label="Connected accounts" value={connected} icon={Mail}
          state={accounts.length ? "ok" : "empty"} href="/invoices/email-accounts" />
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No Gmail accounts connected yet"
          description="Connect a company inbox so the agent can start monitoring for invoices and forwarding them to Finance & Accounts."
          action={<Link href="/invoices/email-accounts"><Button>Connect an account</Button></Link>}
        />
      ) : (
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-foreground">The agent monitors your connected inboxes automatically.</p>
            <p className="text-sm text-muted">
              Supplier invoices are detected and forwarded to Finance &amp; Accounts; anything uncertain waits in the
              approval queue below. Connect or manage mailboxes under Email Accounts.
            </p>
          </CardContent>
        </Card>
      )}

      {canApprove && (
        <div className="mt-6">
          <SampleInvoiceDemo />
        </div>
      )}

      {accounts.length > 0 && (
        <div className="mt-6">
          <ForwardingReview needsAttention={needsAttention} recent={recent} canApprove={canApprove} />
        </div>
      )}
    </div>
  );
}
