# Agent API — connecting Atlas Web Insight to IntelligenceOS

Atlas Web Insight exposes a **read-only Agent API** so the ATLAS **IntelligenceOS**
"super agent" (and its voice assistant) can read this workspace's data — tasks,
SEO/analytics, page audits, technical issues, server/operations status,
competitor research and reports — and answer questions about it.

It implements the **ATLAS Agent API** contract (`atlas-agent-api/1`), the same
one the CRM, Dashboard, HRMS and other ATLAS projects use, so IntelligenceOS
connects to it exactly like any other project.

---

## How it works

1. An **admin** opens **Settings → Agent API** and generates a key, ticking what
   it may read. The key is shown **once** — only its SHA-256 hash is stored.
2. In **IntelligenceOS → Connectors → Connect project**, the admin enters a
   project name, the **Agent API URL** and the key.
3. IntelligenceOS calls `GET <url>/manifest`; Web Insight returns **only the
   actions that key allows**. Those appear on the project's card ("View access").
4. Agents call those actions. Every request carries the key as
   `Authorization: Bearer <key>`, and Web Insight re-checks the key, its scopes,
   expiry, revocation and (optionally) the acting user **on every request**.

**Agent API URL:**

```
https://<your-web-insight-host>/api/agent-api
```

The exact URL (with your real host) is shown on the **Settings → Agent API**
page, ready to copy.

---

## What the key can read (scopes)

Every scope is **read-only**. Presets: *Read everything* (default) or *Website
only*. Individual areas:

| Scope | Area | Reads |
|---|---|---|
| `overview.read` | Executive overview | Open/in-progress/done task counts, priority issues, sites up/down, latest data date. |
| `work.read` | Work & tasks | Tasks, their activity timeline, and the daily work log. |
| `seo.read` | SEO & analytics | Search Console + GA4 totals, trends, top pages and top queries. |
| `inspector.read` | Page audits | Page Inspector audits and their rules-based findings. |
| `issues.read` | Technical issues | The technical SEO issue register. |
| `operations.read` | Backend & server | Server/asset inventory, monitor state, SSL expiry, operations log. |
| `competitors.read` | Competitors | Structured competitor research (observations vs assumptions). |
| `reports.read` | Reports | Generated weekly/monthly reports and their snapshots. |
| `settings.read` | Site & integrations | Website property and integration connection status (no secrets). |
| `invoices.read` | Invoice Agent (finance) | Invoice counts & outstanding totals, invoices (supplier/customer, amounts, due dates, status), what the Invoice Agent has done, and connected inboxes. No bank details or tokens. Reads the separate `atlas_invoice` database; a delegated key is limited to the organisations the acting user belongs to. |

The API never exposes passwords, OAuth tokens, or other users' personal
contact details, and it performs **no writes or deletes**.

---

## Acts as the signed-in user (optional)

When creating a key you can tick **"Act as the signed-in user"**. Then every
request must carry `X-IntelligenceOS-User: <email>` (IntelligenceOS sends the
agent owner's email when the matching box is ticked on the connector). Web
Insight resolves that email to an **active** user with full access and refuses
(`403`) otherwise. Leave it off for a single shared read-only connection.

---

## Security

- Keys are random (`atl_` + 32 random bytes), shown once, stored only as
  `sha256(key)`, and compared in constant time.
- Optional **expiry** and **IP allowlist** (restrict to the IntelligenceOS
  server). Any key can be **revoked** instantly.
- **Rate limited** per key. Requests are logged (`AgentApiLog`) with the key,
  action, acting user, status and timing — shown under *Recent requests*.
- `401` = bad/expired/revoked key (IntelligenceOS marks the project "Needs
  attention"); `403` = key valid but not allowed this action/area/user;
  `429` = too many requests; `503` = store temporarily unavailable.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agent-api/manifest` | The actions this key (and user) may use. |
| `GET` | `/api/agent-api/<action-path>` | Run one read action (see the manifest). |

Example (replace the host and key):

```bash
curl -s https://<host>/api/agent-api/manifest \
  -H "Authorization: Bearer atl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

curl -s "https://<host>/api/agent-api/tasks?status=in_progress&limit=20" \
  -H "Authorization: Bearer atl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

## Where it lives in the code

| File | Role |
|---|---|
| `src/lib/agent-api/keys.ts` | Key generation, hashing, bearer/IP helpers. |
| `src/lib/agent-api/scopes.ts` | The read-scope catalogue and presets. |
| `src/lib/agent-api/repo.ts` | `AgentApiKey` / `AgentApiLog` persistence. |
| `src/lib/agent-api/actions.ts` | The read-only action catalogue + handlers. |
| `src/lib/agent-api/handler.ts` | Auth, manifest, routing, logging. |
| `src/app/api/agent-api/[[...path]]/route.ts` | The HTTP endpoint. |
| `src/app/settings/agent-api/` | Admin UI to generate/revoke keys. |
| `db/schema.sql` | `AgentApiKey` + `AgentApiLog` tables. |

The two tables are **created automatically on first use** (`ensureTables()` in
`repo.ts`), so no manual migration step is required after deploy. `npm run
db:init` also creates them (idempotent) if you prefer to provision up front.
