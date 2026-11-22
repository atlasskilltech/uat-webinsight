import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Mail, Database, Cog, Inbox, FileCheck2, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getInvoiceContext } from "@/lib/invoice/org";
import { getInvoiceDbStatus } from "@/lib/invoice/status";
import { listGmailAccounts } from "@/lib/invoice/services/gmail";
import { iQueryOne } from "@/lib/invoice/db";

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
  const [accounts, emailsSeen, candidates, forwarded] = await Promise.all([
    listGmailAccounts(org),
    count("SELECT COUNT(*) c FROM `email_messages` WHERE organization_id=?", [org]),
    count("SELECT COUNT(*) c FROM `email_messages` WHERE organization_id=? AND is_invoice_candidate=1", [org]),
    // Forwarding is recorded once the forwarding engine runs (later milestone).
    count("SELECT COUNT(*) c FROM `email_messages` WHERE organization_id=? AND processing_status='processed'", [org]),
  ]);
  const connected = accounts.filter((a) => a.status === "connected").length;

  return (
    <div>
      <PageHeader
        title="Invoice Agent"
        description={`Monitoring Gmail for ${ctx.organization?.name ?? "your organization"} and forwarding invoices to Finance & Accounts. All figures are from real activity.`}
        actions={
          <Link href="/invoices/assistant">
            <Button><Bot className="h-4 w-4" /> Open AI Workspace</Button>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Connected accounts" value={connected} icon={Mail}
          state={accounts.length ? "ok" : "empty"} href="/invoices/email-accounts" />
        <StatCard label="Emails monitored" value={emailsSeen} icon={Inbox} state={emailsSeen ? "ok" : "empty"} />
        <StatCard label="Invoices identified" value={candidates} icon={FileCheck2} tone="success" state={candidates ? "ok" : "empty"} />
        <StatCard label="Processed" value={forwarded} icon={Send} state={forwarded ? "ok" : "empty"} />
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
          <CardContent className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">The agent works in the background and on demand.</p>
              <p className="text-sm text-muted">Ask it to check today&apos;s invoices, find duplicates, or forward eligible invoices — in plain language.</p>
            </div>
            <Link href="/invoices/assistant"><Button variant="secondary"><Bot className="h-4 w-4" /> Talk to the agent</Button></Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
