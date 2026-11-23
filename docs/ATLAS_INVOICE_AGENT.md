# Atlas Invoice Agent — Digital Finance & Accounts Employee

A focused AI agent inside Atlas Web Insight that **monitors connected Gmail
accounts, identifies supplier/vendor invoice emails, and forwards them (with the
original attached as `.eml`) to a configurable Finance & Accounts address** — plus
a natural-language workspace to run finance tasks on command. It is **not** an
accounting / procurement system and does not duplicate the university's
procurement software.

> Legend: ✅ works now · 🔑 needs external credentials/config to run live · ⚙️ background

---

## What changed in the scope reset (removed vs built)

**Removed** (UI + dead backend; no existing Atlas module touched, no DB tables dropped):
All AP/AR management surfaces — invoice list/incoming/outgoing/new/detail/print/review,
Vendors·Customers, Products, Payments, Approvals, Due Dates, Needs-Review, Financial
Reports, manual-upload Processing — and their now-unused services (invoices CRUD,
parties, products, payments, approvals, due, sequences, reports, reminders, recurring,
analytics, notifications) plus the AP/AR Zod/enums. Navigation trimmed from 15 links to 4.

**Built / kept for the new mission:**
- Multi-account **Gmail connection** (separate OAuth, encrypted tokens, `gmail.send` added).
- **Background monitoring**: history-based incremental sync, Gmail **push (watch + Pub/Sub)**
  with a secret-verified webhook + watch renewal, and scheduled-pull reconciliation.
- **Invoice detection + auto-forwarding** to one configurable Finance & Accounts address,
  **review-first** (per-account auto-forward toggle; uncertain → review), idempotent, with
  the full original attached as `original.eml`.
- **AI agent** with a monitoring/forwarding tool registry (no raw SQL; writes human-approved).
- **Document intelligence**: PDF text + OCR + AI extraction + deterministic recompute +
  duplicate detection (runs during sync; feeds the agent's read tools).

---

## The four screens

1. **Invoice Agent** (`/invoices`) — status (connected accounts, emails monitored, invoices
   identified, forwarded), **"needs your approval"** (approve/forward-now or dismiss), recent forwards.
2. **AI Workspace** (`/invoices/assistant`) — chat + floating assistant; natural-language tasks.
3. **Connected Accounts** (`/invoices/email-accounts`) — connect/reconnect/disconnect Gmail,
   per-account **auto-forward** toggle, sync status.
4. **Agent Settings** (`/invoices/settings`) — Finance & Accounts destination, confidence
   threshold, enable/pause; database + provider states.

---

## How forwarding works (review-first)

1. ⚙️ Sync (push or scheduled) pulls new mail; each email is classified with a confidence.
2. A forward **task** is queued when a destination is configured:
   - confidence ≥ threshold **and** account auto-forward **on** → `approved` (sent by the worker)
   - confidence ≥ threshold **and** auto-forward **off** → `pending` (waits for a human)
   - confidence < threshold → `review` (human verifies it's an invoice)
3. The forward engine sends `approved` tasks: a new email **from the connected account** to the
   F&A address, subject `Fwd: …`, the **entire original attached as `original.eml`**. Idempotent
   (unique email+destination key), audit-logged, header-injection-safe.
4. Humans approve/dismiss `pending`/`review` from the Invoice Agent home (or via the agent).

**The agent never auto-pays, approves financial commitments, or takes high-impact actions.**
Forwarding/sending from the agent is **approval-gated**.

---

## AI agent tools (LLM has no DB access; never writes SQL)

Read: `list_connected_accounts, search_emails, get_email_details, classify_invoice_email,
get_invoice_attachments, extract_invoice_data, search_invoice_records,
detect_duplicate_invoices, generate_invoice_summary, generate_invoice_report,
identify_pending_invoices, identify_overdue_invoices, get_agent_activity,
draft_follow_up_email` (composes, never sends).
Write (human-approved, then executed server-side): `forward_invoice_email,
send_authorized_email, retry_failed_task`.

---

## Background jobs ⚙️

DB-backed queue (`processing_jobs`, `FOR UPDATE SKIP LOCKED`). Endpoints (bearer
`INVOICE_CRON_SECRET`, falls back to `CRON_SECRET`): `/api/invoices/cron/{sync,forward,drain,all}`.
Worker `scripts/invoice-worker.mjs` (pm2 app `uat-invoice-worker`) drives them. Gmail **push**
webhook: `/api/invoices/gmail/push?token=<secret>`.

---

## Provider status

| Provider | Status | Enable with |
|---|---|---|
| Gmail OAuth (multi-account) | 🔑 | `GMAIL_CLIENT_ID/SECRET/REDIRECT_URI`, Gmail API, **scopes `gmail.readonly` + `gmail.send`**, restricted-scope verification |
| Gmail push (real-time) | 🔑 ⚙️ | `GMAIL_PUBSUB_TOPIC`, a Pub/Sub topic + push subscription to the webhook with `?token=`=`GMAIL_PUBSUB_VERIFICATION_AUDIENCE`. Without it: scheduled pull still works |
| Encryption (tokens) | 🔑 | `INVOICE_ENCRYPTION_KEY` (32-byte base64) — required before connecting Gmail |
| AI extraction / assistant | 🔑 | `AI_PROVIDER=anthropic` **or** `openai`, `AI_MODEL` (a model id for that provider, e.g. `claude-sonnet-5-5` / `gpt-4.1`), `AI_API_KEY`. One model serves both the extractor and the Workspace |
| OCR (scanned docs) | 🔑 | `OCR_PROVIDER=tesseract` (+ `tesseract.js`), **or** `OCR_PROVIDER=documentai` + Google Document AI (`DOCAI_PROJECT_ID`, `DOCAI_LOCATION`, `DOCAI_PROCESSOR_ID`, `GOOGLE_APPLICATION_CREDENTIALS` service account). Text-only; feeds the AI extractor |
| Storage | ✅ local / 🔑 S3 | `INVOICE_STORAGE_PROVIDER=s3` + `S3_*` |

Forwarding is **always on** once a destination + `gmail.send` grant exist — no AI needed.
Everything unconfigured shows an honest "not configured" state.

---

## Environment variables

`ATLAS_INVOICE_DB_*`, `INVOICE_ENCRYPTION_KEY`, `GMAIL_CLIENT_ID/SECRET/REDIRECT_URI`,
`GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_VERIFICATION_AUDIENCE`, `GMAIL_QUERY`, `GMAIL_SYNC_DAYS`,
`GMAIL_SYNC_INTERVAL_MIN`, `AI_PROVIDER/AI_MODEL/AI_API_KEY`, `OCR_PROVIDER`,
`DOCAI_PROJECT_ID/DOCAI_LOCATION/DOCAI_PROCESSOR_ID/GOOGLE_APPLICATION_CREDENTIALS` (Document AI OCR),
`INVOICE_STORAGE_PROVIDER` (+`S3_*`), `INVOICE_CRON_SECRET`, `INVOICE_WORKER_*`. See `.env.example`.

### OCR via Google Cloud Document AI (optional, text-only)
Set `OCR_PROVIDER=documentai` and provide the four `DOCAI_*`/`GOOGLE_APPLICATION_CREDENTIALS`
variables above. Auth is a Google Cloud **service account** (role *Document AI API User*),
not an API key — the agent mints a short-lived OAuth token from the key (no SDK). It is
engaged only for scanned PDFs/images with no embedded text, and returns recognized text to
the existing AI extractor; GST/total recomputation, duplicate detection and forwarding are
unchanged. If any variable is missing the provider stays honestly "not configured" (OCR off).

---

## Tests & build

`npm test` — **39 Vitest tests pass**: money/GST engine, AES-256-GCM crypto, storage/upload
validation + signed tokens, email classifier, **forwarding `.eml` MIME builder**
(addresses the destination, embeds a decodable original, blocks header injection), formatting.
`tsc --noEmit` ✅ · `eslint` ✅ · `next build` ✅ (4 invoice pages + 5 API routes; existing
Atlas routes intact). Live Gmail/AI/OCR/Pub-Sub can't run in the build env.

---

## Run locally

```bash
npm install
cp .env.example .env     # set ATLAS_INVOICE_DB_*, INVOICE_ENCRYPTION_KEY (+ providers)
npm run db:init          # existing app schema (unchanged)
npm run invoice:db:init  # create/migrate atlas_invoice (incl. migration 007 forwarding)
npm run dev && npm test
```
Then: sign in as admin → **Invoice Agent → Agent Settings** → create org + set the Finance
& Accounts destination → **Connected Accounts** → connect Gmail → enable auto-forward per
account when ready.

## Start the worker
```bash
npm run invoice:worker   # needs APP_URL + INVOICE_CRON_SECRET (or CRON_SECRET), app running
```
Or trigger directly: `curl -X POST -H "Authorization: Bearer $INVOICE_CRON_SECRET" $APP_URL/api/invoices/cron/all`

## Deploy to EC2
Existing GitHub Actions deploy (push to `staging`) runs `npm ci`, `db:init`, `build`,
`pm2 startOrReload`. For the agent, on the server: run `npm run invoice:db:init`, set the new
env vars in `.env`, and `pm2 startOrReload ecosystem.config.js` (includes `uat-invoice-worker`).
Configure the Google Cloud OAuth client + (optional) Pub/Sub. Add `atlas_invoice` backups.

---

## Remaining production blockers

- 🔑 Verified Gmail OAuth client with **`gmail.send`** (restricted-scope Google review has lead time).
- 🔑 `INVOICE_ENCRYPTION_KEY` set before connecting any account.
- 🔑 (optional) Pub/Sub topic + push subscription for real-time; otherwise scheduled pull.
- ⚙️ Automated `atlas_invoice` backups (not yet automated).
- Live end-to-end + security pass on a MySQL-enabled host with real credentials.

Dormant (kept, data-safe, unused by the new scope): the AP/AR tables remain in `atlas_invoice`
but no code reads/writes them except the extraction records (`invoices`, `invoice_line_items`,
`invoice_extractions`, `invoice_duplicate_matches`) used for invoice intelligence.
