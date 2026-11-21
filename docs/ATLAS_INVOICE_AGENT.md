# Atlas Invoice Agent — Implementation Report

An AI-powered Accounts Payable + Accounts Receivable finance module added **inside**
the existing Atlas Web Insight app. Built additively; no existing module, route, or
database table was changed. Single-organization model, additive sidebar.

> Status legend: ✅ **Available/Done** · 🔧 **Reuses existing** · 🆕 **New** · 🔑 **Needs external config to run live**

---

## 1. What was implemented (by milestone)

| Milestone | Scope | State |
|---|---|---|
| **A — Foundation** | Dedicated `atlas_invoice` DB + migrations + runner, isolated mysql2 pool, BigInt money/GST engine, AES-256-GCM crypto, private storage (local/S3) + upload validation, DB-backed job queue, org isolation + capability permissions, audit, nav group, Overview + Settings | ✅ |
| **B — Invoice management** | Vendors/customers, products, incoming (AP) + outgoing (AR) invoices with deterministic totals + auto-numbering, payments (transactional, over-pay guard), approvals (amount-bound), due dates, printable invoice | ✅ |
| **C — AI processing** | Upload → store → PDF text / OCR → AI extract → Zod → recompute + cross-check → duplicate detection → confidence → Needs Review; provider-independent adapters; document serving | ✅ (AI/OCR 🔑) |
| **D — Gmail** | Separate OAuth (multi-account, encrypted tokens), connect/disconnect/reconnect, sync with dedupe → pipeline, classification, backoff/reauth | ✅ (🔑 verified OAuth) |
| **E — AI Agent** | Tool registry (no SQL), policy engine, Anthropic tool-use orchestrator, approval-gated writes, persisted conversations/runs, dedicated workspace + floating assistant | ✅ (AI 🔑) |
| **F — Automation & reporting** | Worker + cron endpoints, scheduled Gmail sync, due-date reminders (in-app+email), recurring drafts, notifications, financial reports (+CSV), dashboard analytics | ✅ |
| **G — QA & delivery** | Vitest suite (44 tests), regression (tsc/eslint/build), this report | ✅ |

---

## 2. Routes and pages (23 pages + 4 API routes)

**Pages** (`src/app/invoices/`): `/invoices` (Overview + analytics), `/invoices/list`,
`/invoices/incoming`, `/invoices/outgoing`, `/invoices/new`, `/invoices/[id]`,
`/invoices/[id]/print`, `/invoices/[id]/review`, `/invoices/parties`,
`/invoices/products`, `/invoices/payments`, `/invoices/approvals`,
`/invoices/due-dates`, `/invoices/email-accounts`, `/invoices/processing`,
`/invoices/needs-review`, `/invoices/reports`, `/invoices/assistant`,
`/invoices/settings`.

**API routes**: `POST/GET /api/invoices/cron/[task]` (bearer),
`GET /api/invoices/documents` (signed token + org check),
`GET /api/invoices/gmail/connect`, `GET /api/invoices/gmail/callback`.

**Sidebar** (`src/lib/nav.ts`, additive "Invoice Agent" group): Invoice Overview,
All/Incoming/Outgoing Invoices, Email Accounts, Processing Queue, Needs Review,
Vendors & Customers, Products & Services, Payments, Approvals, Due Dates,
Financial Reports, AI Invoice Assistant, Invoice Settings.

---

## 3. Database (dedicated `atlas_invoice`, raw MySQL — 36 tables)

Migrations in `db/invoice/*.sql`, applied by `npm run invoice:db:init` (idempotent,
tracked in `_invoice_migrations`). **Never touches `atlas_dashboard`.**

- **Tenancy**: `organizations`, `organization_members`
- **Master data**: `invoice_parties`, `products_services`, `invoice_sequences`
- **Invoices**: `invoices`, `invoice_line_items`, `invoice_attachments`,
  `invoice_extractions`, `invoice_credit_notes`, `invoice_credit_note_items`
- **Finance ops**: `invoice_payments`, `invoice_payment_allocations`,
  `invoice_approvals`, `invoice_approval_steps`, `invoice_reminders`,
  `invoice_subscriptions`, `invoice_duplicate_matches`
- **Gmail/email**: `gmail_integrations`, `gmail_sync_states`, `email_messages`,
  `email_attachments`
- **Infra**: `processing_jobs`, `invoice_audit_logs`, `notifications`,
  `notification_preferences`
- **Agent**: `agent_conversations`, `agent_messages`, `agent_runs`, `agent_steps`,
  `agent_tool_calls`, `agent_tasks`, `agent_memory`, `agent_approvals`,
  `agent_activity_logs`, `agent_settings`

All money is `DECIMAL`; every tenant row carries `organization_id`; InnoDB, utf8mb4,
FKs, indexes, unique dedupe keys.

---

## 4. Services & libraries (`src/lib/invoice/`)

`db.ts` (dedicated pool), `config.ts`, `money.ts` (BigInt GST engine), `crypto.ts`
(AES-256-GCM), `storage.ts` (local/S3 + magic-byte validation + signed tokens),
`audit.ts`, `org.ts` (isolation), `permissions.ts`, `types.ts`, `enums.ts`,
`format.ts`, `validation.ts` (Zod), `status.ts`, `overview.ts`, `jobs.ts` (queue).
`services/`: `parties, products, sequences, invoices, payments, approvals, due,
duplicates, processing, gmail, agent, notifications, reminders, recurring, reports,
analytics, orgs`. `ai/`: `pdf-text, ocr, extract, types`. `gmail/`: `oauth, api`.
`agent/`: `tools, policy, llm, orchestrator`. `worker/handlers.ts`.

---

## 5. AI agent tools (LLM has no DB/SQL access)

Read: `list_invoices, get_invoice, find_overdue, summarize_due, overview_metrics,
search_parties, list_payments, find_duplicates, find_gst_mismatches,
list_pending_approvals`. Write (approval-gated): `record_payment`. Each tool has a
required capability + Zod schema; writes create an `agent_approvals` request and run
only after a human approves.

---

## 6. Background jobs & automation

DB-backed queue (`processing_jobs`, `FOR UPDATE SKIP LOCKED`). Cron endpoints
`/api/invoices/cron/{sync,reminders,recurring,drain,all}` (bearer). Worker
`scripts/invoice-worker.mjs` drives them on intervals (added as pm2 app
`uat-invoice-worker`). Tasks: due Gmail sync, due-date reminders (in-app + email,
deduped), recurring invoice drafts, queue drain. Inline today: OCR/AI extraction,
validation, dedupe (run during upload/sync).

---

## 7–9. Provider status

| Provider | Status | To enable |
|---|---|---|
| **PDF text** | ✅ Works with no external service (`pdf-parse`) | — |
| **OCR** | 🔑 Off until configured | `OCR_PROVIDER` (+ optional `tesseract.js`) |
| **AI extraction + agent** | 🔑 Anthropic adapter; off until configured | `AI_PROVIDER=anthropic`, `AI_MODEL`, `AI_API_KEY` |
| **Gmail** | 🔑 Full flow built; needs verified OAuth client | `GMAIL_CLIENT_ID/SECRET/REDIRECT_URI`, Gmail API, restricted-scope verification |
| **Storage** | ✅ Local default; 🔑 S3 optional | `INVOICE_STORAGE_PROVIDER=s3` + `S3_*` (+ `@aws-sdk/client-s3`) |
| **Email** | 🔧 Reuses app's Resend/SendGrid | existing `EMAIL_*` |
| **Encryption** | 🔑 Required before Gmail | `INVOICE_ENCRYPTION_KEY` (32-byte base64) |

All unconfigured features show an **honest "not configured" state** — none are faked.

---

## 10. Environment variables (new; see `.env.example`)

DB: `ATLAS_INVOICE_DB_HOST/PORT/USER/PASSWORD/NAME`. Security:
`INVOICE_ENCRYPTION_KEY`. AI: `AI_PROVIDER/AI_MODEL/AI_API_KEY`. OCR:
`OCR_PROVIDER/OCR_API_KEY`. Gmail: `GMAIL_CLIENT_ID/SECRET/REDIRECT_URI`,
`GMAIL_PUBSUB_*` (optional), `GMAIL_QUERY/SYNC_DAYS/SYNC_INTERVAL_MIN`. Storage:
`INVOICE_STORAGE_PROVIDER`, `INVOICE_STORAGE_DIR`, `INVOICE_MAX_UPLOAD_MB`, `S3_*`.
Automation: `INVOICE_CRON_SECRET`, `INVOICE_WORKER_*`, `INVOICE_WORKER_CONCURRENCY`,
`INVOICE_JOB_RETRY_LIMIT`.

---

## 11. Tests executed (actual results)

`npm test` (Vitest) — **44 passed / 44** across 6 files:
- `money.test.ts` (13): parse/format, half-up rounding, qty/percent, GST split
  (CGST/SGST/IGST), odd-amount exact split, invoice totals, round-off, claimed-total
  cross-check.
- `crypto.test.ts` (6): AES-256-GCM round-trip, no plaintext leak, unique IV, tamper
  + malformed rejection, null handling.
- `storage.test.ts` (10): magic-byte sniffing (PDF/PNG/JPG/WebP), upload validation
  (size, declared/content mismatch), signed-token round-trip/expiry/tamper.
- `validation.test.ts` (8): party/product/line/invoice/payment Zod schemas.
- `format.test.ts` (3): money formatting, financial year, date input.
- `classify.test.ts` (4): email classification heuristic.

**Not runnable in this environment** (no MySQL / external providers here): live DB
migrations, transactional flows, Gmail/AI/OCR/S3 integration, agent tool loop. These
are written and type-safe; run them on a MySQL-enabled host with providers configured.

---

## 12. Build results

`npx tsc --noEmit` ✅ · `npx eslint` ✅ · `npm run build` ✅ (all invoice routes
compiled; existing routes intact). Build warnings are the expected "Critical
dependency" notices from intentional guarded optional imports (`tesseract.js`,
`pdf-parse` internal, `@aws-sdk`) — benign.

---

## 13. Security measures

Server-side capability checks on every action/route/tool; organization isolation on
every query (resolved server-side, never from client); AES-256-GCM for OAuth tokens;
upload validation by file signature; duplicate-processing prevention; LLM restricted
to registered tools (no SQL), approvals human-controlled; signed + authz-checked
document access; bearer-secured cron; immutable audit trail; prompt-injection-aware
system prompts (document text treated as data). CSRF via Next Server Actions + signed
OAuth state.

---

## 14. Outstanding external setup (before production)

- Provision `atlas_invoice` DB + run `npm run invoice:db:init`.
- Set `INVOICE_ENCRYPTION_KEY`; configure AI/OCR/Gmail/S3 as needed (each gated).
- Gmail: create a **separate verified** Google Cloud OAuth client (restricted-scope
  review has lead time); optional Pub/Sub for push.
- **Automated DB backups** for `atlas_invoice` (mysqldump/snapshots) — required for
  financial data; not yet automated.
- Deploy the worker (pm2) or point an external scheduler at the cron endpoints.

---

## 15. Run locally

```bash
npm install
cp .env.example .env            # fill DB + INVOICE_ENCRYPTION_KEY (+ providers as needed)
npm run db:init                 # existing app schema (unchanged)
npm run invoice:db:init         # create/migrate atlas_invoice
npm run dev                     # http://localhost:3000
npm test                        # run the unit suite
```
Sign in as the admin → **Invoice Agent → Invoice Settings → Create organization**.

## 16. Start the worker

```bash
npm run invoice:worker          # needs APP_URL + INVOICE_CRON_SECRET (or CRON_SECRET) and the app running
```
Or trigger tasks directly:
```bash
curl -X POST -H "Authorization: Bearer $INVOICE_CRON_SECRET" http://localhost:3000/api/invoices/cron/all
```

## 17. Deploy to EC2 (existing pipeline)

The GitHub Actions deploy (`.github/workflows/stagingweb.yml`, push to `staging`)
already runs `npm ci`, `db:init`, `build`, `pm2 startOrReload`. For the Invoice Agent,
add on the server: run `npm run invoice:db:init` once (and on schema changes), set the
new env vars in `.env`, and `pm2 startOrReload ecosystem.config.js` (now includes the
`uat-invoice-worker` app). Set up `mysqldump` backups for `atlas_invoice`.

---

## Files created / modified

**Created**: `db/invoice/*.sql`, `scripts/invoice-db-init.ts`,
`scripts/invoice-worker.mjs`, `src/lib/invoice/**`, `src/app/invoices/**`,
`src/app/api/invoices/**`, `test/**`, `vitest.config.ts`, this doc.

**Modified (additive only)**: `src/lib/nav.ts` (Finance group), `package.json`
(scripts + deps: `pdf-parse`, dev `vitest`), `.env.example` (documented vars),
`.gitignore` (local storage), `ecosystem.config.js` (worker app), `tsconfig.json`
(target ES2017→ES2020 for BigInt). **Not modified**: `db/schema.sql`, `src/lib/db.ts`,
`src/auth.ts`, the 9 existing module folders, existing cron routes.

---

## Not production-ready until

Essential external integrations (AI/OCR/Gmail), automated `atlas_invoice` backups, and
a full live end-to-end + security pass on a MySQL-enabled host are completed. The code
is implemented, type-checked, linted, unit-tested and building; live provider behaviour
remains to be exercised with real credentials.
