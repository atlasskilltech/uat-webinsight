import type { Metadata } from "next";
import Link from "next/link";
import {
  Receipt,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Cog,
  Database,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getInvoiceContext } from "@/lib/invoice/org";
import { getInvoiceDbStatus } from "@/lib/invoice/status";
import { getOverviewMetrics } from "@/lib/invoice/overview";

export const metadata: Metadata = { title: "Invoice Overview" };
export const dynamic = "force-dynamic";

const CURRENCY_SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

function fmtMoney(value: string, currency = "INR"): string {
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const neg = value.startsWith("-");
  const [intPart, frac = "00"] = (neg ? value.slice(1) : value).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${sym}${grouped}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

export default async function InvoiceOverviewPage() {
  const ctx = await getInvoiceContext();
  // Layout already guaranteed access; ctx is non-null here.
  const dbStatus = await getInvoiceDbStatus();

  // 1) Invoice database not initialized yet.
  if (!dbStatus.migrated) {
    return (
      <div>
        <PageHeader
          title="Invoice Agent"
          description="AI-powered accounts payable & receivable for Atlas."
        />
        <EmptyState
          icon={Database}
          title={dbStatus.reachable ? "Invoice database not initialized" : "Invoice database unreachable"}
          description={
            dbStatus.reachable
              ? "The dedicated atlas_invoice database has no tables yet. A server admin needs to run the migrations: npm run invoice:db:init"
              : `Could not reach the invoice database. Check ATLAS_INVOICE_DB_* settings. ${dbStatus.error ?? ""}`
          }
        />
      </div>
    );
  }

  // 2) Migrated, but this user has no organization yet (setup mode).
  if (!ctx?.organizationId) {
    return (
      <div>
        <PageHeader
          title="Invoice Agent"
          description="AI-powered accounts payable & receivable for Atlas."
        />
        <EmptyState
          icon={Cog}
          title="Finish Invoice Agent setup"
          description="Create your finance organization to start managing incoming and outgoing invoices."
          action={
            ctx?.canSetup ? (
              <Link href="/invoices/settings">
                <Button>Go to Invoice Settings</Button>
              </Link>
            ) : (
              <span className="text-sm text-muted">Ask a Finance Admin to complete setup.</span>
            )
          }
        />
      </div>
    );
  }

  // 3) Normal dashboard — real records only.
  const m = await getOverviewMetrics(ctx.organizationId);
  const currency = ctx.organization?.base_currency ?? "INR";
  const hasAny = m.incoming.totalInvoices > 0 || m.outgoing.totalInvoices > 0;

  return (
    <div>
      <PageHeader
        title="Invoice Overview"
        description={`Accounts payable & receivable for ${ctx.organization?.name ?? "your organization"}. All figures come from stored records.`}
      />

      {!hasAny && (
        <EmptyState
          className="mb-6"
          icon={Receipt}
          title="No invoices yet"
          description="Upload a supplier invoice, connect a Gmail inbox, or create a customer invoice to get started. Metrics below update from real records only — never sample data."
        />
      )}

      {/* Accounts Payable */}
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <ArrowDownCircle className="h-4 w-4 text-accent" /> Accounts Payable — Incoming
      </h2>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Supplier invoices" value={m.incoming.totalInvoices} icon={Receipt}
          state={m.incoming.totalInvoices ? "ok" : "empty"} href="/invoices/incoming" />
        <StatCard label="Total payable" value={fmtMoney(m.incoming.totalPayable, currency)} icon={ArrowDownCircle}
          state={m.incoming.totalInvoices ? "ok" : "empty"} tone="warning" />
        <StatCard label="Needs review" value={m.incoming.needsReview} icon={AlertTriangle}
          state={m.incoming.needsReview ? "ok" : "empty"} tone="warning" href="/invoices/list?view=needs-review" />
        <StatCard label="Awaiting approval" value={m.incoming.awaitingApproval} icon={Clock}
          state={m.incoming.awaitingApproval ? "ok" : "empty"} />
        <StatCard label="Unpaid" value={m.incoming.unpaid} state={m.incoming.unpaid ? "ok" : "empty"} />
        <StatCard label="Partially paid" value={m.incoming.partiallyPaid} state={m.incoming.partiallyPaid ? "ok" : "empty"} />
        <StatCard label="Overdue" value={m.incoming.overdue} tone="danger" state={m.incoming.overdue ? "ok" : "empty"} />
        <StatCard label="Due in 7 days" value={m.incoming.upcomingDue} state={m.incoming.upcomingDue ? "ok" : "empty"} />
      </div>

      {/* Accounts Receivable */}
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <ArrowUpCircle className="h-4 w-4 text-accent" /> Accounts Receivable — Outgoing
      </h2>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Customer invoices" value={m.outgoing.totalInvoices} icon={Receipt}
          state={m.outgoing.totalInvoices ? "ok" : "empty"} href="/invoices/outgoing" />
        <StatCard label="Total receivable" value={fmtMoney(m.outgoing.totalReceivable, currency)} icon={ArrowUpCircle}
          state={m.outgoing.totalInvoices ? "ok" : "empty"} tone="success" />
        <StatCard label="Draft" value={m.outgoing.draft} state={m.outgoing.draft ? "ok" : "empty"} />
        <StatCard label="Sent" value={m.outgoing.sent} state={m.outgoing.sent ? "ok" : "empty"} />
        <StatCard label="Paid" value={m.outgoing.paid} icon={CheckCircle2} tone="success" state={m.outgoing.paid ? "ok" : "empty"} />
        <StatCard label="Partially paid" value={m.outgoing.partiallyPaid} state={m.outgoing.partiallyPaid ? "ok" : "empty"} />
        <StatCard label="Overdue" value={m.outgoing.overdue} tone="danger" state={m.outgoing.overdue ? "ok" : "empty"} />
        <StatCard label="Issued" value={m.outgoing.issued} state={m.outgoing.issued ? "ok" : "empty"} />
      </div>

      {/* Processing queue (DB-backed jobs) */}
      <Card>
        <CardHeader>
          <CardTitle>AI processing queue</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(["queued", "running", "succeeded", "failed", "dead"] as const).map((s) => (
            <div key={s} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <p className="text-lg font-semibold tabular-nums">{m.jobs[s]}</p>
              <p className="text-xs capitalize text-muted">{s}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
