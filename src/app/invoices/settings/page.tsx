import type { Metadata } from "next";
import { Database, KeyRound, Bot, ScanLine, Mail, HardDrive, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getInvoiceContext, listUserOrganizations } from "@/lib/invoice/org";
import { hasCapability } from "@/lib/invoice/permissions";
import { getInvoiceDbStatus, getGstinUniquenessStatus } from "@/lib/invoice/status";
import { getInvoiceFeatureFlags } from "@/lib/invoice/config";
import { getForwardingSettings, listCcRecipients, listSenderFilters } from "@/lib/invoice/services/forwarding";
import { listMembers, listOrganizationsBrief, addressText } from "@/lib/invoice/services/org-admin";
import { OrganizationsManager, OrgForm } from "./organizations-client";
import { TeamMembers } from "./team-members";
import { ForwardingSettingsForm } from "./forwarding-form";
import { CcRecipients } from "./cc-recipients";
import { SenderFilters } from "./sender-filters";

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

/** Wrap read-only content shown to non-Finance-Admin roles with a clear notice. */
function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-muted">
        <ShieldCheck className="h-3.5 w-3.5" /> Finance Admin access required to edit
      </div>
      {children}
    </div>
  );
}

export default async function InvoiceSettingsPage() {
  const [ctx, dbStatus] = await Promise.all([getInvoiceContext(), getInvoiceDbStatus()]);
  const flags = getInvoiceFeatureFlags();
  const forwarding = ctx?.organizationId ? await getForwardingSettings(ctx.organizationId) : null;
  const ccRecipients = ctx?.organizationId ? await listCcRecipients(ctx.organizationId) : [];
  const senderFilters = ctx?.organizationId
    ? await listSenderFilters(ctx.organizationId)
    : { configured: false, allow: [], block: [] };
  const canManageOrg = ctx?.organizationId ? await hasCapability("org.manage") : false;
  const canManageSettings = ctx?.organizationId ? await hasCapability("settings.manage") : false;
  const members = ctx?.organizationId && canManageOrg ? await listMembers(ctx.organizationId) : [];
  // Multi-org: the organizations this user belongs to (for the management list
  // + switcher). Finance Admins manage; others get a read-only view.
  const userOrgs = ctx?.user && ctx.organizationId ? await listUserOrganizations(ctx.user) : [];
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

      {/* Organizations (multi-org management + switcher) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>
            Each organization is an isolated tenant with its own GST/company profile, team, forwarding destinations, CC
            recipients, rules and document categories — reusable across every email-forwarding workflow, not only
            invoices. Finance Admins can create and manage multiple organizations and switch the active one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!dbStatus.migrated ? (
            <p className="text-sm text-muted">Initialize the database first, then reload this page.</p>
          ) : ctx?.organizationId && ctx.organization ? (
            canManageOrg ? (
              <OrganizationsManager
                organizations={userOrgs}
                activeOrgId={ctx.organizationId}
                activeProfile={{
                  id: ctx.organization.id,
                  name: ctx.organization.name,
                  legal_name: ctx.organization.legal_name,
                  gstin: ctx.organization.gstin,
                  pan: ctx.organization.pan,
                  base_currency: ctx.organization.base_currency,
                  address: addressText(ctx.organization.address),
                }}
              />
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
                  members and create further organizations. Reusing an existing GSTIN or name is blocked to prevent duplicates.
                </p>
                <OrgForm mode="create" />
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

      {/* Email forwarding — destination (per organization) */}
      {ctx?.organizationId && forwarding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Destination email</CardTitle>
            <CardDescription>
              The email address this organization&apos;s documents are forwarded to. Each organization has its own
              destination — changing it here never affects another organization. Editable by Finance Admin only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canManageSettings ? (
              <>
                <ForwardingSettingsForm destination={forwarding.financeDestination ?? ""} />
                {!forwarding.financeDestination && (
                  <p className="mt-3 text-xs text-warning">
                    No destination set yet — documents for this organization will NOT be forwarded until you add one.
                  </p>
                )}
              </>
            ) : (
              <ReadOnlyNote>
                <dl className="grid grid-cols-1 gap-3">
                  <div><dt className="text-xs text-muted">Destination email</dt><dd className="text-sm font-medium">{forwarding.financeDestination ?? "Not configured"}</dd></div>
                </dl>
              </ReadOnlyNote>
            )}
          </CardContent>
        </Card>
      )}

      {/* Allowed senders + exclusions (always shown; a setup notice appears until migration 011 creates the table) */}
      {ctx?.organizationId && forwarding && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Allowed senders &amp; exclusions</CardTitle>
            <CardDescription>
              Control which senders this organization forwards. When any allowed senders are listed, ONLY mail from them
              is forwarded; excluded senders (e.g. a specific vendor) are never forwarded — exclusions always override the
              allowed list. Each entry is a full email address or a whole domain, and applies to this organization only.
              Editable by Finance Admin only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!senderFilters.configured ? (
              <div className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground">
                <p className="font-medium">Setup required to activate</p>
                <p className="mt-1 text-xs text-muted">
                  Per-organization sender filtering is installed but not yet activated on this environment. A one-time
                  database migration must be applied (<code>npm run invoice:db:init</code>, which creates the{" "}
                  <code>forwarding_sender_filters</code> table). Until then no sender gating is applied and forwarding
                  behaves as before. Once activated, add this organization&apos;s allowed senders and vendor exclusions
                  here — each organization keeps its own independent lists.
                </p>
              </div>
            ) : canManageSettings ? (
              <SenderFilters allow={senderFilters.allow} block={senderFilters.block} />
            ) : (
              <ReadOnlyNote>
                <div className="space-y-4">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted">Allowed senders</p>
                    {senderFilters.allow.length === 0 ? (
                      <p className="text-sm text-muted">None — this organization will not forward any mail.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">{senderFilters.allow.map((f) => <li key={f.id}>{f.pattern}</li>)}</ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted">Excluded senders</p>
                    {senderFilters.block.length === 0 ? (
                      <p className="text-sm text-muted">None.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">{senderFilters.block.map((f) => <li key={f.id}>{f.pattern}</li>)}</ul>
                    )}
                  </div>
                </div>
              </ReadOnlyNote>
            )}
          </CardContent>
        </Card>
      )}

      {/* CC recipients (hidden until the forwarding_cc_recipients table exists) */}
      {ctx?.organizationId && forwarding && !dbStatus.schemaOutdated && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>CC recipients</CardTitle>
            <CardDescription>
              These addresses are CC&apos;d on every forwarded document, in addition to the destination (which stays the
              primary recipient). Editable by Finance Admin only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canManageSettings ? (
              <CcRecipients recipients={ccRecipients} />
            ) : (
              <ReadOnlyNote>
                {ccRecipients.length === 0 ? (
                  <p className="text-sm text-muted">No CC recipients configured.</p>
                ) : (
                  <ul className="space-y-1 text-sm">{ccRecipients.map((r) => <li key={r.id}>{r.email}</li>)}</ul>
                )}
              </ReadOnlyNote>
            )}
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
