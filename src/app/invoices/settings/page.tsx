import type { Metadata } from "next";
import { Database, KeyRound, Bot, ScanLine, Mail, HardDrive, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getInvoiceContext } from "@/lib/invoice/org";
import { getInvoiceDbStatus } from "@/lib/invoice/status";
import { getInvoiceFeatureFlags } from "@/lib/invoice/config";
import { getForwardingSettings } from "@/lib/invoice/services/forwarding";
import { SetupOrganizationForm } from "./setup-client";
import { ForwardingSettingsForm } from "./forwarding-form";

export const metadata: Metadata = { title: "Invoice Settings" };
export const dynamic = "force-dynamic";

function StateRow({
  icon: Icon,
  label,
  ok,
  okText,
  hint,
}: {
  icon: typeof Database;
  label: string;
  ok: boolean;
  okText?: string;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted">{hint}</p>
        </div>
      </div>
      <span
        className={
          "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium " +
          (ok ? "bg-success-soft text-success" : "bg-surface-2 text-muted")
        }
      >
        {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
        {ok ? okText ?? "Configured" : "Not configured"}
      </span>
    </div>
  );
}

export default async function InvoiceSettingsPage() {
  const [ctx, dbStatus] = await Promise.all([getInvoiceContext(), getInvoiceDbStatus()]);
  const flags = getInvoiceFeatureFlags();
  const forwarding = ctx?.organizationId ? await getForwardingSettings(ctx.organizationId) : null;

  return (
    <div>
      <PageHeader
        title="Invoice Settings"
        description="Set up the Invoice Agent: organization, database, AI/OCR, Gmail, storage and security providers."
      />

      {/* Database */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Database</CardTitle>
          <CardDescription>Dedicated atlas_invoice database (separate from the main app).</CardDescription>
        </CardHeader>
        <CardContent>
          <StateRow
            icon={Database}
            label="Invoice database"
            ok={dbStatus.migrated}
            okText="Migrated"
            hint={
              dbStatus.migrated
                ? "Schema is present and reachable."
                : dbStatus.reachable
                  ? "Reachable but not migrated. Run:  npm run invoice:db:init"
                  : `Unreachable. Check ATLAS_INVOICE_DB_* env. ${dbStatus.error ?? ""}`
            }
          />
        </CardContent>
      </Card>

      {/* Organization / setup */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>Finance tenant that owns all invoice data.</CardDescription>
        </CardHeader>
        <CardContent>
          {!dbStatus.migrated ? (
            <p className="text-sm text-muted">Initialize the database first, then reload this page.</p>
          ) : ctx?.organizationId ? (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Name</dt>
                <dd className="text-sm font-medium">{ctx.organization?.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Base currency</dt>
                <dd className="text-sm font-medium">{ctx.organization?.base_currency}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">GSTIN</dt>
                <dd className="text-sm font-medium">{ctx.organization?.gstin ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Your finance role</dt>
                <dd className="text-sm font-medium">{ctx.role}</dd>
              </div>
            </dl>
          ) : ctx?.canSetup ? (
            <SetupOrganizationForm />
          ) : (
            <EmptyState
              title="No organization yet"
              description="A Finance Admin must create the organization before you can use the Invoice Agent."
            />
          )}
        </CardContent>
      </Card>

      {/* Finance & Accounts forwarding */}
      {ctx?.organizationId && forwarding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Finance &amp; Accounts forwarding</CardTitle>
            <CardDescription>
              The single destination the agent forwards invoice emails to, and the confidence needed to auto-forward.
              Emails below the threshold wait for review on the Invoice Agent home.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ForwardingSettingsForm
              destination={forwarding.financeDestination ?? ""}
              minConfidence={forwarding.minConfidence}
              enabled={forwarding.enabled}
            />
          </CardContent>
        </Card>
      )}

      {/* Providers */}
      <Card>
        <CardHeader>
          <CardTitle>Providers & security</CardTitle>
          <CardDescription>
            Accurate connection states. Features that need a provider stay inactive until it is configured —
            nothing here is simulated.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-1">
          <StateRow
            icon={KeyRound}
            label="Encryption (AES-256-GCM)"
            ok={flags.encryptionConfigured}
            hint="Required to store Gmail tokens & bank details. Set INVOICE_ENCRYPTION_KEY (32-byte base64)."
          />
          <StateRow
            icon={Bot}
            label="AI extraction"
            ok={flags.aiConfigured}
            hint="Set AI_PROVIDER, AI_MODEL and AI_API_KEY to enable invoice field extraction and the assistant."
          />
          <StateRow
            icon={ScanLine}
            label="OCR"
            ok={flags.ocrConfigured}
            hint="Set OCR_PROVIDER=tesseract, or =documentai with the DOCAI_* service-account vars, to read scanned PDFs and images."
          />
          <StateRow
            icon={Mail}
            label="Gmail integration"
            ok={flags.gmailConfigured}
            hint="Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REDIRECT_URI (separate from the GSC/GA4 OAuth)."
          />
          <StateRow
            icon={HardDrive}
            label={`Document storage (${flags.storageProvider})`}
            ok={flags.storageProvider === "local" ? true : flags.s3Configured}
            okText={flags.storageProvider === "local" ? "Local" : "S3"}
            hint={
              flags.storageProvider === "local"
                ? "Local private storage (INVOICE_STORAGE_DIR). Switch to S3 with INVOICE_STORAGE_PROVIDER=s3."
                : "Set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (+ install @aws-sdk/client-s3)."
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
