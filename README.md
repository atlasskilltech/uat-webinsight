# Atlas Web Insight

A central workspace for managing day-to-day work at Atlas University and the SEO,
analytics, technical and operational health of **atlasuniversity.edu.in** — plus
management-ready weekly/monthly reporting.

Built with **Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Prisma ·
SQLite · Recharts**. Light **and** dark theme, responsive, accessible.

---

## What's implemented

Nine modules, all backed by a real persistent database:

| Module | Route | What it does |
| --- | --- | --- |
| **Executive Dashboard** | `/` | KPIs (work + website), performance & task-completion trends, priority issues, deadlines, recent activity, latest reports, quick actions. |
| **My Work** | `/work` | Full task management (list / table / board / calendar views), filters, search, sort, create/edit with validation, activity timeline, **daily work log**, weekly summary chips. |
| **SEO & Analytics** | `/seo` | Search Console **and** GA4 performance, kept clearly separate, with date-range selection and previous-period comparison, trends and top pages. |
| **Page Inspector** | `/inspector` | Audit any URL: on-page/technical SEO (status, indexability, robots, canonical, title/meta, headings, images/alt, links, structured data), optional PageSpeed/Core Web Vitals, and a **rules-based diagnostic engine** that separates *confirmed* issues from *hypotheses*. |
| **Technical SEO Issues** | `/issues` | Issue register linked to audited URLs, with severity/approval workflow, filters and status summaries. |
| **Backend & Server** | `/operations` | Server/asset inventory (SSL expiry tracking) + an operations log. Documentation-only — never touches a live server. |
| **Competitor Intelligence** | `/competitors` | Structured research, with public **observations** explicitly separated from **assumptions**. |
| **Reports & History** | `/reports` | Generate weekly/monthly reports (12 sections), period comparison, editable executive summary, **Print/PDF** and **CSV** export, saved history. |
| **Settings & Integrations** | `/settings` | Website property, Google connection status, **CSV import**, import history, and demo-data management. |

### Honesty guarantees (by design)
- Every figure comes from stored/imported data. Missing data shows **"No data"** or
  **"Not connected"** — never an invented number.
- All seeded sample data is flagged **DEMO DATA** and can be removed in one click
  (Settings → Data & Imports → *Remove all demo data*).
- A page returning HTTP 200 is **not** reported as "indexed"; low traffic is treated
  as a *hypothesis to investigate*, never as proof of a defect.
- Secrets and OAuth tokens stay on the server (server-only modules, API routes).

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create the database, generate the client, and load demo data
npm run setup        # = prisma generate + migrate deploy + seed
#   (or, for development:  npx prisma migrate dev  &&  npm run db:seed)

# 3. Run the app
npm run dev
# open http://localhost:3000

# 4. Sign in with Google. The designated admin (tech@atlasuniversity.edu.in)
#    is granted admin automatically on first sign-in while no admin exists.
#    If an admin already exists or you're locked out, use the recovery CLI:
#    npm run grant-admin           # defaults to the designated admin email
```

The app ships with an `.env` pointing at a local SQLite file
(`prisma/dev.db`) — **no database server required**. Copy `.env.example` to
`.env` if you need to change anything.

### Useful scripts
| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` / `npm start` | Production build / serve. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run db:migrate` | Create/apply a migration (dev). |
| `npm run db:seed` | Load clearly-labelled demo data (replaces demo rows only). |
| `npm run db:reset` | Drop & recreate the DB, then seed. |
| `npm run db:studio` | Open Prisma Studio to browse the data. |

---

## Architecture

```
src/
  app/
    page.tsx                 Executive Dashboard (+ dashboard-charts.tsx)
    work/                    Tasks + daily log (actions, forms, client views)
    seo/                     Search Console + GA4 analytics
    inspector/               Page auditing (+ [id] detail)
    issues/ operations/ competitors/   Register-style modules
    reports/                 Report generation, view, export (+ [id])
    settings/                Property, integrations, CSV import
    api/integrations/google/ OAuth connect + callback routes
  components/
    ui/                      Design-system primitives (Card, Button, Badge,
                             form controls, Table, StatCard, Dialog, Toast, …)
    charts/                  Recharts wrappers (themed)
    shell/                   Sidebar, topbar, command palette, app shell
  lib/
    prisma.ts  enums.ts  validation.ts  form-state.ts
    metrics.ts  report-data.ts          Aggregation + report assembly
    crawler.ts  diagnostics.ts          Page Inspector engine
    google.ts  integrations.ts  csv-import.ts  csv-export.ts
    dates.ts  series.ts  utils.ts  glossary.ts  settings.ts
prisma/
  schema.prisma  migrations/  seed.ts
```

**Key decisions**
- **SQLite via Prisma** for zero-config, fully persistent local storage. The schema
  is portable: enum-like fields are stored as strings and validated with Zod, and
  structured data uses `Json`. To switch to **MySQL** (e.g. XAMPP) or Postgres,
  change `datasource.provider` + `DATABASE_URL` in `prisma/schema.prisma` and run
  `npx prisma migrate dev`.
- **Server Components + Server Actions** for data; **Zod** validates every mutation
  on the server. Client components handle only interactivity (forms, dialogs, charts).
- **Import provenance**: every metric row records `source`, `propertyId`, period and
  import timestamp via an `ImportBatch`, and carries an `isDemo` flag.

---

## Connecting Google data (Search Console & GA4)

Two ways to get real data in — see **[SETUP-INTEGRATIONS.md](./SETUP-INTEGRATIONS.md)**
for full, step-by-step instructions.

1. **CSV import (works immediately, no setup).** Export from Search Console / GA4 and
   upload under **Settings → Data & Imports**. Sample files and the expected columns
   are provided (`public/samples/`).
2. **Google OAuth API (live sync).** Configure a Google Cloud OAuth client, set
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, connect once in Settings, set your
   property ids, then **Sync**. The OAuth + REST client code is implemented against
   the official APIs; it activates only once credentials are present.

> If credentials aren't configured, the app clearly says **Not connected** and the
> CSV workflow remains fully functional.

### Generating a weekly report
Reports → **Generate report** → pick a period (This week / Last week / monthly /
custom) → generate. The report freezes a snapshot of the figures at that moment,
shows previous-period comparison, and can be printed to PDF or exported to CSV. Edit
the executive summary and mark the report **Final** when ready to share.

---

## Testing & verification done
- `npm run build` — compiles cleanly (14 routes). `npm run typecheck` — passes.
- All nine module routes and the dynamic detail routes render (HTTP 200) with seed data.
- Forms validate server-side; CSV import validates columns, skips invalid rows, and
  records provenance; reports handle missing/zero data without dividing by zero.

## Known limitations / remaining setup
- **Live Google sync** requires your own Google Cloud OAuth credentials and authorised
  property access (documented). Without them, use CSV import.
- The Page Inspector fetches **public** HTML only; pages that block bots, or that
  render entirely client-side, yield limited on-page data (handled gracefully).
- PageSpeed Insights is rate-limited without an optional API key.
- **Authentication is required — Google Sign-In (Auth.js).** The login page offers
  **Continue with Google**; access is restricted to approved accounts in the `User` table
  (unknown Google accounts are denied). Two roles — **Admin** and **Standard User** —
  enforced on the server for every page and admin action, not just hidden in the UI. The
  designated initial admin (`tech@atlasuniversity.edu.in`) is granted automatically on
  first Google sign-in while no admin exists; otherwise use the authorized local recovery
  CLI `npm run grant-admin`. Admins add/approve users and change roles at **/admin/users**
  (no public self-registration, no passwords — Google proves identity). Requires
  `AUTH_SECRET` in `.env` and the login redirect URI registered in Google Cloud (see
  `SETUP-INTEGRATIONS.md`). This is separate from the GSC/GA4 data OAuth and the cron
  endpoint, which keep their own credentials.

## Recommended first week at Atlas
1. **Settings** → set the website property and your name; import a recent GSC and GA4
   CSV (or connect Google), then **remove demo data**.
2. **My Work** → add your current tasks; log what you do each day.
3. **Page Inspector** → audit 3–5 important URLs (homepage, admissions, a key blog
   post); promote confirmed findings into the **Issues** register.
4. **Competitors** → log 2–3 public observations from peer universities.
5. **Reports** → generate your first weekly report on Friday, edit the summary, mark
   it Final, and export the PDF for management.
```
