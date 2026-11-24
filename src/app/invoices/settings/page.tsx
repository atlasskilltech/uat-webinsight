import type { Metadata } from "next";
import { Database, KeyRound, Bot, ScanLine, Mail, HardDrive, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getInvoiceContext } from "@/lib/invoice/org";
import { hasCapability } from "@/lib/invoice/permissions";
import { getInvoiceDbStatus, getGstinUniquenessStatus } from "@/lib/invoice/status";
import { getInvoiceFeatureFlags } from "@/lib/invoice/config";
import { getForwardingSettings, listCcRecipients } from "@/lib/invoice/services/forwarding";
import { listMembers, listOrganizationsBrief } from "@/lib/invoice/services/org-admin";
import { listCategories, listDestinations, listRules } from "@/lib/invoice/services/routing";
import { listGmailAccounts } from "@/lib/invoice/services/gmail";
import { SetupOrganizationForm } from "./setup-client";
import { OrgProfileForm } from "./org-profile-form";
import { TeamMembers } from "./team-members";
import { ForwardingSettingsForm } from "./forwarding-form";
import { CcRecipients } from "./cc-recipients";
import { DestinationsManager, CategoriesManager, RulesManager } from "./routing-client";

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
  const ccRecipients = ctx?.organizationId ? await listCcRecipients(ctx.organizationId) : [];
  const canManageOrg = ctx?.organizationId ? await hasCapability("org.manage") : false;
  const canManageSettings = ctx?.organizationId ? await hasCapability("settings.manage") : false;
  const members = ctx?.organizationId && canManageOrg ? await listMembers(ctx.organizationId) : [];
  // Phase 6: configurable forwarding routing (hidden until migration 010 ran and
  // only for Finance Admins who can manage settings). Falls back to the legacy
  // single-destination form below when routing isn't ready.
  const showRouting = Boolean(ctx?.organizationId && dbStatus.routingReady && canManageSettings);
  const [routeDestinations, routeCategories, routeRules, routeMailboxes] = showRouting
    ? await Promise.all([
        listDestinations(ctx!.organizationId!),
        listCategories(ctx!.organizationId!),
        listRules(ctx!.organizationId!),
        listGmailAccounts(ctx!.organizationId!).then((a) => a.map((m) => ({ id: m.id, email: m.email }))),
      ])
    : [[], [], [], []];
  // Shown during setup so an admin can see existing orgs and avoid duplicates.
  const existingOrgs = ctx && !ctx.organizationId && ctx.canSetup ? await listOrganizationsBrief() : [];
  // Live state of the GSTIN unique index (migration 009 may have skipped it).
  const gstinUniq = dbStatus.migrated && !dbStatus.schemaOutdated ? await getGstinUniquenessStatus() : null;

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
          <CardDescription>Invoice Agent database (set by ATLAS_INVOICE_DB_NAME; its own tables, may share atlas_dashboard).</CardDescription>
        </CardHeader>
        <CardContent>
          <StateRow
            icon={Database}
            label="Invoice database"
            ok={dbStatus.migrated && !dbStatus.schemaOutdated}
            okText="Migrated"
            hint={
              !dbStatus.reachable
                ? `Unreachable. Check ATLAS_INVOICE_DB_* env. ${dbStatus.error ?? ""}`
                : dbStatus.schemaOutdated
                  ? "Schema upgrade pending — some tables are missing. Run:  npm run invoice:db:init"
                  : dbStatus.migrated
                    ? "Schema is present and reachable."
                    : "Reachable but not migrated. Run:  npm run invoice:db:init"
            }
          />
          {gstinUniq && (
            <StateRow
              icon={ShieldCheck}
              label="GSTIN uniqueness (database-level)"
              ok={gstinUniq.enforced}
              okText="Enforced"
              hint={
                gstinUniq.enforced
                  ? "A unique index prevents two organizations from sharing a GSTIN (race-safe)."
                  : gstinUniq.duplicateGroups > 0
                    ? `Not enforced — ${gstinUniq.duplicateGroups} duplicate GSTIN(s) exist. Resolve them, then run:  npm run invoice:db:init`
                    : "Not enforced yet. Run:  npm run invoice:db:init"
              }
            />
          )}
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
          ) : ctx?.organizationId && ctx.organization ? (
            canManageOrg ? (
              <OrgProfileForm org={ctx.organization} />
            ) : (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">Name</dt>
                  <dd className="text-sm font-medium">{ctx.organization.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Legal name</dt>
                  <dd className="text-sm font-medium">{ctx.organization.legal_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">GSTIN</dt>
                  <dd className="text-sm font-medium">{ctx.organization.gstin ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">PAN</dt>
                  <dd className="text-sm font-medium">{ctx.organization.pan ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Base currency</dt>
                  <dd className="text-sm font-medium">{ctx.organization.base_currency}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Your finance role</dt>
                  <dd className="text-sm font-medium">{ctx.role}</dd>
                </div>
              </dl>
            )
          ) : ctx?.canSetup ? (
            <div className="space-y-5">
              {existingOrgs.length > 0 && (
                <div className="rounded-lg border border-border bg-surface-2 p-4">
                  <p className="text-sm font-medium text-foreground">You&apos;re not a member of any organization yet.</p>
                  <p className="mt-1 text-sm text-muted">
                    If your organization is already set up, ask its Finance Admin to add you under <strong>Team members</strong>
                    {" "}rather than creating a new one. Existing organizations:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-foreground">
                    {existingOrgs.map((o) => (
                      <li key={o.id}>• {o.name}{o.gstin ? ` — GSTIN ${o.gstin}` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">
                  {existingOrgs.length > 0 ? "Create a separate organization" : "Create your organization"}
                </p>
                <p className="mb-3 text-xs text-muted">
                  Use a distinct name and GSTIN. The person who creates it becomes its Finance Admin and can then add team
                  members. Reusing an existing GSTIN or name is blocked to prevent duplicates.
                </p>
                <SetupOrganizationForm />
              </div>
            </div>
          ) : ctx?.orgExists ? (
            <EmptyState
              title="You're not a member yet"
              description="Ask your organization's Finance Admin to add you under Team Members, then reload this page."
            />
          ) : (
            <EmptyState
              title="No organization yet"
              description="An administrator must create the organization before you can use the Invoice Agent."
            />
          )}
        </CardContent>
      </Card>

      {/* Team members (Finance Admin: org.manage) */}
      {ctx?.organizationId && ctx.user && canManageOrg && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Team members</CardTitle>
            <CardDescription>
              Add Atlas employees by their existing Web Insight login email and assign a finance role. Every member
              shares this one organization and its GST/company profile — no duplicate organizations are created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TeamMembers members={members} currentUserId={ctx.user.id} />
          </CardContent>
        </Card>
      )}

      {/* Finance & Accounts forwarding */}
      {ctx?.organizationId && forwarding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Default forwarding destination</CardTitle>
            <CardDescription>
              The default destination the agent forwards invoice emails to, and the confidence needed to auto-forward.
              Emails below the threshold wait for review on the Invoice Agent home. When forwarding rules are configured,
              this is used as the fallback whenever no rule matches.
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

      {/* CC recipients (hidden until the forwarding_cc_recipients table exists) */}
      {ctx?.organizationId && forwarding && !dbStatus.schemaOutdated && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>CC recipients</CardTitle>
            <CardDescription>
              These addresses are CC&apos;d on every forwarded invoice, in addition to the Finance &amp; Accounts
              destination (which stays the primary recipient).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CcRecipients recipients={ccRecipients} />
          </CardContent>
        </Card>
      )}

      {/* Phase 6 — configurable forwarding routing (Finance Admin). Hidden until
          migration 010 has run; the legacy default destination above stays the
          fallback when no rule matches. */}
      {showRouting && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Forwarding destinations</CardTitle>
              <CardDescription>
                Reusable Finance/AP mailboxes that rules forward to. Each can carry its own CC recipients (merged with the
                organization-wide CC list on every send).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DestinationsManager destinations={routeDestinations} />
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Document categories</CardTitle>
              <CardDescription>
                Invoice, Purchase Order, Statement and Other are built-in. Add custom categories to route specific document
                types with rules.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CategoriesManager categories={routeCategories} />
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Forwarding rules</CardTitle>
              <CardDescription>
                Route by organization mailbox, sender and document category, in priority order, with a fallback destination.
                The highest-priority enabled rule that matches wins; if none match, the default destination above is used
                (existing behaviour). Test a rule before enabling it — nothing is sent during a test.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RulesManager
                rules={routeRules}
                destinations={routeDestinations}
                categories={routeCategories}
                mailboxes={routeMailboxes}
              />
            </CardContent>
          </Card>
        </>
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
