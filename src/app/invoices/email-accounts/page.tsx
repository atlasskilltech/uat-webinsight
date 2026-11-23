import type { Metadata } from "next";
import { Mail, Info, KeyRound } from "lucide-react";
import { getInvoiceContext } from "@/lib/invoice/org";
import { gmailConfigured } from "@/lib/invoice/gmail/oauth";
import { isEncryptionConfigured } from "@/lib/invoice/crypto";
import { listGmailAccounts } from "@/lib/invoice/services/gmail";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NotReady } from "../not-ready";
import { EmailAccountsClient, type GmailAccountView } from "./email-accounts-client";
import { AutoRefresh } from "../auto-refresh";

export const metadata: Metadata = { title: "Email Accounts" };
export const dynamic = "force-dynamic";

export default async function EmailAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Email Accounts" canSetup={ctx?.canSetup} />;

  const sp = await searchParams;
  const configured = gmailConfigured();
  const encryptionOk = isEncryptionConfigured();

  const rows = configured ? await listGmailAccounts(ctx.organizationId) : [];
  const accounts: GmailAccountView[] = rows.map((g) => ({
    id: g.id,
    email: g.email,
    status: g.status,
    lastError: g.last_error,
    invoiceDetected: Number(g.invoice_detected),
    forwardedCount: Number(g.forwarded_count),
    pendingCount: Number(g.pending_count),
    lastSyncAt: g.last_sync_at ? new Date(g.last_sync_at).toISOString() : null,
    consecutiveFailures: Number(g.consecutive_failures),
    autoForward: Boolean(g.auto_forward),
  }));

  return (
    <div>
      <PageHeader
        title="Email Accounts"
        description="Connect company Gmail inboxes. The agent reads invoice emails, downloads attachments and runs them through the processing pipeline. Read-only access; tokens are encrypted at rest."
      />

      {!configured ? (
        <EmptyState
          icon={Mail}
          title="Gmail is not configured"
          description="Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REDIRECT_URI from a dedicated Google Cloud OAuth client (Gmail API enabled; scopes gmail.readonly + gmail.send — restricted-scope verification required). This is separate from the Search Console / Analytics OAuth."
        />
      ) : !encryptionOk ? (
        <EmptyState
          icon={KeyRound}
          title="Encryption key required"
          description="Set INVOICE_ENCRYPTION_KEY before connecting Gmail, so OAuth tokens are encrypted at rest. Generate a 32-byte base64 key and add it in your environment."
        />
      ) : (
        <>
          <AutoRefresh seconds={60} />
          <div className="mb-6 flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Connected accounts sync automatically in the background (about every 5 minutes), so the counts below
              update on their own. Each sync scans recent emails with attachments, skips already-processed messages,
              classifies them, and sends invoice attachments to the pipeline. Use <strong>Sync now</strong> to run it
              immediately, or <strong>Rescan inbox</strong> to re-check recent mail with the latest detection. Real-time
              push (Gmail watch + Pub/Sub) activates only when that infrastructure is configured.
            </p>
          </div>
          <EmailAccountsClient
            accounts={accounts}
            notice={sp.connected ? { type: "success", text: `Connected ${sp.connected}.` } : sp.error ? { type: "error", text: decodeURIComponent(sp.error) } : null}
          />
        </>
      )}
    </div>
  );
}
