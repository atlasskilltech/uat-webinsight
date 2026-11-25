# Migration 011 — Sender Filters: Staging Rollout Runbook

**Migration:** `db/invoice/011_sender_filters.sql` (creates `forwarding_sender_filters`)
**Feature:** per-organisation **allowed senders** + **vendor exclusions** for Invoice Agent forwarding
**Target:** `staging` (UAT) — DB is the Invoice Agent database (`ATLAS_INVOICE_DB_NAME`, e.g. `diceapp_adobe`)
**Owner action:** these steps run on the staging server / DB by a human. Claude does not run migrations or modify the database.

---

## 0. TL;DR

1. Code is **already deployed** to staging (merge of PR #82, deploy run #84). ✅
2. The feature is **dormant** until the migration is applied — forwarding currently behaves exactly as before.
3. Applying `011` **activates strict gating**: an organisation with **no allowed senders forwards nothing**.
4. So the safe order is: **back up → apply migration → immediately add each org's allowed senders (and exclusions)**.

---

## 1. Why this is needed

The `stagingweb.yml` deploy workflow runs `npm run db:init` (the main dashboard schema), **not** `npm run invoice:db:init` (the Invoice Agent migrations). So merging PR #82 shipped the **code** but did **not** create the `forwarding_sender_filters` table. The code is missing-table-safe:

- **Table absent (now):** `listSenderFilters` returns `configured: false` → **no gating**. Forwarding is unchanged.
- **Table present (after 011):** gating is **active**. Allowed senders are required; with none set for an org, that org forwards nothing. Exclusions always win.

## 2. What migration 011 does

Creates one table (create-only, no data change, safe to re-run):

```sql
CREATE TABLE IF NOT EXISTS `forwarding_sender_filters` (
    `id`              VARCHAR(191) NOT NULL,
    `organization_id` VARCHAR(191) NOT NULL,
    `kind`            VARCHAR(8)   NOT NULL,  -- 'allow' | 'block'
    `pattern`         VARCHAR(320) NOT NULL,  -- full email OR bare domain, lower-cased
    `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `forwarding_sender_filters_org_kind_pattern_key` (`organization_id`, `kind`, `pattern`),
    INDEX `forwarding_sender_filters_org_idx` (`organization_id`),
    CONSTRAINT `forwarding_sender_filters_org_fk` FOREIGN KEY (`organization_id`)
        REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`npm run invoice:db:init` applies **all** `db/invoice/*.sql` in order (001 → 011). 001–010 are already applied and idempotent, so they are no-ops; only 011 is new.

## 3. Behaviour change when activated (read before running)

- **Strict empty allow-list:** an organisation with zero allowed senders forwards **nothing** (by design — this was the chosen behaviour).
- **Allowed senders:** once ≥1 exists, only mail from those senders forwards.
- **Excluded senders** (e.g. `razorpay.com`): never forwarded, even if otherwise allowed.
- **Patterns:** a full address (`billing@acme.com`) or a bare domain (`acme.com`, also matches sub-domains), case-insensitive.
- **Enforced everywhere:** sync queue-time, manual approval, AI-agent forward, and the final `sendForward` send — so a sender excluded after an item was queued is still withheld (shown as `skipped` with a reason in **Recent forwards**).
- **Not forwarded ≠ lost:** such mail is still ingested/recorded; only the forward is withheld.

> ⚠️ **Operational risk:** if you apply 011 without adding allowed senders, **all orgs stop forwarding** until senders are added. Do step 6 right after step 5.

## 4. Pre-flight

- [ ] Confirm the staging code is at the PR #82 merge (deploy run #84 succeeded).
- [ ] Take a DB backup / snapshot of the Invoice Agent database (standard practice even for a create-only migration).
- [ ] Have the list of allowed senders (and any exclusions) ready for **each** organisation.
- [ ] Do **not** change environment variables; the migration uses the existing `ATLAS_INVOICE_DB_*` connection config.

## 5. Apply the migration

On the staging host, from the app directory:

```bash
npm run invoice:db:init
```

Expected: the script reports applying `011_sender_filters.sql` (and skipping/no-op for 001–010). Re-running is safe (idempotent).

## 6. Configure allowed senders per organisation (do immediately after)

For **each** active organisation, in the app:

1. Go to **Invoice → Settings → Allowed senders & exclusions** (Finance Admin only; the card appears once the table exists).
2. Add the **allowed senders** that should be forwarded (full address or domain). Until at least one is added, that org forwards nothing.
3. Add any **excluded senders** (e.g. a vendor like `razorpay.com`).

> If you want an org to keep forwarding everything for now, that is **not** possible under the strict setting — the allow-list must contain the senders/domains you want forwarded. (Changing this would be a product-requirement change and is out of scope.)

## 7. Verify

**Database:**
```sql
SHOW TABLES LIKE 'forwarding_sender_filters';
DESCRIBE `forwarding_sender_filters`;
SELECT organization_id, kind, pattern FROM `forwarding_sender_filters` ORDER BY organization_id, kind, pattern;
```

**App:**
- **Invoice → Settings → Database**: schema shows migrated (no "schema upgrade pending").
- **Invoice → Settings → Allowed senders & exclusions**: the card is visible and lists the entries you added; the empty-allow-list warning disappears once an allowed sender exists.

**Functional smoke test (use a test org / test inbox — do not use real vendor data):**
- An email from an **allowed** sender with a document attachment → appears for forwarding / forwards per the org's settings.
- An email from an **excluded** sender → withheld; if it reached the queue, it shows as `skipped` with the exclusion reason in **Recent forwards**.
- An org with **no allowed senders** → nothing forwards.

## 8. Rollback options

- **Preferred (no data change):** to pause gating for an org, you cannot "allow all" under the strict model — instead keep the allow-list populated with the intended senders. To stop *forwarding* for an org entirely, clear its allowed senders (reversible) or deactivate the org.
- **Full revert to pre-feature behaviour (destructive):** dropping the table returns the code to `configured: false` (no gating). This **loses all configured allow/exclude entries** and should only be done deliberately:
  ```sql
  -- destructive: removes all per-org sender filters; reverts to NO gating
  DROP TABLE IF EXISTS `forwarding_sender_filters`;
  ```
  The application tolerates the table being absent (missing-table-safe), so no code change is required to revert. Re-applying `011` later recreates an empty table (gating strict again until senders are added).

## 9. Notes

- No other migration is needed; destination uses `forwarding_settings` (007) and CC uses `forwarding_cc_recipients` (008), both already deployed.
- From-header based matching trusts the `From` address (no SPF/DKIM verification) — inherent to sender-based filtering.
- Sync-time withheld documents are recorded in the `invoice_audit` log (`forwarding.withheld_sender`); there is no dedicated audit-log viewer UI yet, so the clearly visible signal is the `skipped` entries in **Recent forwards**.
