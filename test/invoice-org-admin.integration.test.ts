/**
 * MySQL-backed integration test for admin-managed organization membership and
 * the shared organization (GST) profile. Mirrors the real deployment where the
 * Invoice Agent shares the main Web Insight database (so the `User` table and
 * the invoice tables live together).
 *
 * Skips gracefully when no MySQL is reachable (keeps CI green). Configure with
 * the same ITEST_DB_* envs as the forwarding integration test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import mysql2 from "mysql2/promise";

const DB = {
  host: process.env.ITEST_DB_HOST || "127.0.0.1",
  port: Number(process.env.ITEST_DB_PORT || 3306),
  user: process.env.ITEST_DB_USER || "root",
  password: process.env.ITEST_DB_PASSWORD ?? "",
  name: process.env.ITEST_DB_NAME_ORGADMIN || "atlas_orgadmin_itest",
};

async function dbReachable(): Promise<boolean> {
  try {
    const c = await mysql2.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, connectTimeout: 2500 });
    await c.end();
    return true;
  } catch {
    return false;
  }
}

const READY = await dbReachable();
if (!READY) {
  // eslint-disable-next-line no-console
  console.warn(`[invoice-org-admin.integration] no MySQL at ${DB.host}:${DB.port} — skipping.`);
}

// Imported after env is set in beforeAll (pools are created lazily on first query).
import { iQuery, iQueryOne, iExecute } from "@/lib/invoice/db";
import {
  anyActiveOrganizationExists,
  listOrganizationsBrief,
  findDuplicateOrganization,
  listMembers,
  addMemberByEmail,
  updateMemberRole,
  removeMember,
  updateOrganizationProfile,
} from "@/lib/invoice/services/org-admin";
import { getGstinUniquenessStatus } from "@/lib/invoice/status";

const ACTOR = { id: "u_tech", email: "tech@atlas.test" };
const ORG_A = "orgA";
const ORG_B = "orgB";
const GSTIN_A = "27AAAAA0000A1Z5";

async function applyInvoiceMigrations(conn: mysql2.Connection): Promise<void> {
  const dir = path.join(process.cwd(), "db", "invoice");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await conn.query(readFileSync(path.join(dir, f), "utf8"));
  }
}

async function resetPools(): Promise<void> {
  const g = globalThis as unknown as { __pool?: { end?: () => Promise<void> }; __invoicePool?: { end?: () => Promise<void> } };
  await g.__pool?.end?.().catch(() => undefined);
  await g.__invoicePool?.end?.().catch(() => undefined);
  delete g.__pool;
  delete g.__invoicePool;
}

describe.skipIf(!READY)("invoice org-admin — MySQL integration (disposable DB)", () => {
  beforeAll(async () => {
    const admin = await mysql2.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS \`${DB.name}\``);
    await admin.query(`CREATE DATABASE \`${DB.name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`USE \`${DB.name}\``);
    await applyInvoiceMigrations(admin);
    // Minimal Web Insight `User` table (main app) — shares the same DB here.
    await admin.query(
      "CREATE TABLE IF NOT EXISTS `User` (" +
        "`id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `email` VARCHAR(191) NOT NULL, " +
        "`role` VARCHAR(191) NOT NULL DEFAULT 'user', `status` VARCHAR(191) NOT NULL DEFAULT 'active', " +
        "PRIMARY KEY (`id`), UNIQUE KEY `User_email_key` (`email`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    );
    await admin.end();

    await resetPools();
    // Both the main pool and the invoice pool point at the same disposable DB.
    process.env.DB_HOST = DB.host;
    process.env.DB_PORT = String(DB.port);
    process.env.DB_USER = DB.user;
    process.env.DB_PASSWORD = DB.password;
    process.env.DB_NAME = DB.name;
    process.env.ATLAS_INVOICE_DB_HOST = DB.host;
    process.env.ATLAS_INVOICE_DB_PORT = String(DB.port);
    process.env.ATLAS_INVOICE_DB_USER = DB.user;
    process.env.ATLAS_INVOICE_DB_PASSWORD = DB.password;
    process.env.ATLAS_INVOICE_DB_NAME = DB.name;
  }, 60_000);

  afterAll(async () => {
    await resetPools();
    const admin = await mysql2.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password }).catch(() => null);
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${DB.name}\``).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  beforeEach(async () => {
    for (const t of ["organization_members", "organizations", "User"]) {
      await iExecute(`DELETE FROM \`${t}\``).catch(() => undefined);
    }
    // Web Insight accounts (reused — never created by the invoice module).
    await iExecute("INSERT INTO `User` (`id`,`name`,`email`,`role`,`status`) VALUES (?,?,?,?,?)", ["u_tech", "Tech", "tech@atlas.test", "admin", "active"]);
    await iExecute("INSERT INTO `User` (`id`,`name`,`email`,`role`,`status`) VALUES (?,?,?,?,?)", ["u_office", "Office", "office@atlas.test", "user", "active"]);
    await iExecute("INSERT INTO `User` (`id`,`name`,`email`,`role`,`status`) VALUES (?,?,?,?,?)", ["u_third", "Third", "third@atlas.test", "user", "active"]);
    await iExecute("INSERT INTO `User` (`id`,`name`,`email`,`role`,`status`) VALUES (?,?,?,?,?)", ["u_inact", "Inactive", "inactive@atlas.test", "user", "inactive"]);
    await iExecute("INSERT INTO `User` (`id`,`name`,`email`,`role`,`status`) VALUES (?,?,?,?,?)", ["u_other", "Other", "other@atlas.test", "user", "active"]);

    // Org A (Atlas) with the shared GST + Tech as the Finance Admin.
    await iExecute("INSERT INTO `organizations` (`id`,`name`,`gstin`,`base_currency`) VALUES (?,?,?,?)", [ORG_A, "Atlas University", GSTIN_A, "INR"]);
    await iExecute(
      "INSERT INTO `organization_members` (`id`,`organization_id`,`user_id`,`user_email`,`role`,`status`) VALUES (?,?,?,?,?,'active')",
      ["m_tech", ORG_A, "u_tech", "tech@atlas.test", "FINANCE_ADMIN"],
    );
    // A separate, isolated Org B with its own member (for the isolation test).
    await iExecute("INSERT INTO `organizations` (`id`,`name`,`gstin`,`base_currency`) VALUES (?,?,?,?)", [ORG_B, "Other Co", "29BBBBB0000B1Z5", "INR"]);
    await iExecute(
      "INSERT INTO `organization_members` (`id`,`organization_id`,`user_id`,`user_email`,`role`,`status`) VALUES (?,?,?,?,?,'active')",
      ["m_other", ORG_B, "u_other", "other@atlas.test", "FINANCE_ADMIN"],
    );
  });

  it("adds an existing Web Insight user to the shared org — they get the SAME org + GST", async () => {
    const res = await addMemberByEmail(ORG_A, ACTOR, "office@atlas.test", "FINANCE_VIEWER");
    expect(res.ok).toBe(true);

    const m = await iQueryOne<{ organization_id: string; role: string; user_id: string }>(
      "SELECT organization_id, role, user_id FROM `organization_members` WHERE user_email='office@atlas.test' AND status='active'",
    );
    expect(m?.organization_id).toBe(ORG_A); // same org as Tech
    expect(m?.user_id).toBe("u_office"); // reused the existing Web Insight account
    // Both members resolve to the one org row → one shared GST profile.
    const org = await iQueryOne<{ gstin: string }>("SELECT gstin FROM `organizations` WHERE id=?", [ORG_A]);
    expect(org?.gstin).toBe(GSTIN_A);
    const members = await listMembers(ORG_A);
    expect(members.map((x) => x.user_email).sort()).toEqual(["office@atlas.test", "tech@atlas.test"]);
  });

  it("refuses an email with no Web Insight account (never creates a login)", async () => {
    const res = await addMemberByEmail(ORG_A, ACTOR, "ghost@atlas.test", "FINANCE_VIEWER");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no web insight account/i);
    expect(await iQueryOne("SELECT 1 AS x FROM `organization_members` WHERE user_email='ghost@atlas.test'")).toBeNull();
  });

  it("refuses an inactive Web Insight account", async () => {
    const res = await addMemberByEmail(ORG_A, ACTOR, "inactive@atlas.test", "FINANCE_VIEWER");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not active/i);
  });

  it("is idempotent — adding an existing member again is refused", async () => {
    await addMemberByEmail(ORG_A, ACTOR, "office@atlas.test", "FINANCE_USER");
    const again = await addMemberByEmail(ORG_A, ACTOR, "office@atlas.test", "FINANCE_USER");
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already a member/i);
  });

  it("keeps organizations isolated — refuses to add a member of a DIFFERENT org", async () => {
    const res = await addMemberByEmail(ORG_A, ACTOR, "other@atlas.test", "FINANCE_VIEWER");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/different organization/i);
    // other@ stays only in Org B.
    const orgs = await iQuery<{ organization_id: string }>("SELECT organization_id FROM `organization_members` WHERE user_email='other@atlas.test' AND status='active'");
    expect(orgs.map((o) => o.organization_id)).toEqual([ORG_B]);
  });

  it("rejects an invalid role and an invalid email", async () => {
    expect((await addMemberByEmail(ORG_A, ACTOR, "office@atlas.test", "SUPER_ADMIN")).ok).toBe(false);
    expect((await addMemberByEmail(ORG_A, ACTOR, "not-an-email", "FINANCE_VIEWER")).ok).toBe(false);
  });

  it("changes a member's role, but never demotes the only Finance Admin", async () => {
    await addMemberByEmail(ORG_A, ACTOR, "office@atlas.test", "FINANCE_VIEWER");
    const office = (await listMembers(ORG_A)).find((m) => m.user_email === "office@atlas.test")!;
    expect((await updateMemberRole(ORG_A, ACTOR, office.id, "FINANCE_USER")).ok).toBe(true);

    // Tech is the only admin — demotion blocked.
    const demote = await updateMemberRole(ORG_A, ACTOR, "m_tech", "FINANCE_VIEWER");
    expect(demote.ok).toBe(false);
    expect(demote.message).toMatch(/only finance admin/i);

    // Promote office to admin, THEN Tech can be demoted.
    await updateMemberRole(ORG_A, ACTOR, office.id, "FINANCE_ADMIN");
    expect((await updateMemberRole(ORG_A, ACTOR, "m_tech", "FINANCE_VIEWER")).ok).toBe(true);
  });

  it("removes a member (soft revoke) and can re-add them (reactivates)", async () => {
    await addMemberByEmail(ORG_A, ACTOR, "office@atlas.test", "FINANCE_USER");
    const office = (await listMembers(ORG_A)).find((m) => m.user_email === "office@atlas.test")!;
    expect((await removeMember(ORG_A, ACTOR, office.id)).ok).toBe(true);
    expect((await listMembers(ORG_A)).some((m) => m.user_email === "office@atlas.test")).toBe(false);

    // Can't remove the only admin.
    expect((await removeMember(ORG_A, ACTOR, "m_tech")).ok).toBe(false);

    // Re-adding reactivates (ON DUPLICATE KEY) — still one row per (org,user).
    const re = await addMemberByEmail(ORG_A, ACTOR, "office@atlas.test", "FINANCE_VIEWER");
    expect(re.ok).toBe(true);
    const rows = await iQuery("SELECT id FROM `organization_members` WHERE organization_id=? AND user_id='u_office'", [ORG_A]);
    expect(rows.length).toBe(1);
  });

  it("edits the shared organization profile (GST/name/PAN) with validation", async () => {
    const bad = await updateOrganizationProfile(ORG_A, ACTOR, { name: "Atlas", legalName: null, gstin: "SHORT", pan: null, baseCurrency: "INR" });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/gstin/i);

    const ok = await updateOrganizationProfile(ORG_A, ACTOR, {
      name: "Atlas University Finance",
      legalName: "Atlas SkillTech University",
      gstin: "27ZZZZZ9999Z1Z5",
      pan: "AAAAA1111A",
      baseCurrency: "INR",
    });
    expect(ok.ok).toBe(true);
    const org = await iQueryOne<{ name: string; legal_name: string; gstin: string; pan: string }>(
      "SELECT name, legal_name, gstin, pan FROM `organizations` WHERE id=?",
      [ORG_A],
    );
    expect(org).toMatchObject({ name: "Atlas University Finance", legal_name: "Atlas SkillTech University", gstin: "27ZZZZZ9999Z1Z5", pan: "AAAAA1111A" });
  });

  it("reports that an organization already exists (first-setup signal)", async () => {
    expect(await anyActiveOrganizationExists()).toBe(true);
    await iExecute("DELETE FROM `organization_members`");
    await iExecute("DELETE FROM `organizations`");
    expect(await anyActiveOrganizationExists()).toBe(false);
  });

  it("duplicate guard: blocks a same-GSTIN or same-name org, but ALLOWS a genuinely separate org", async () => {
    // Same GSTIN as Atlas (Org A) => accidental duplicate, matched on gstin.
    const byGst = await findDuplicateOrganization(GSTIN_A, "Atlas University (dup attempt)");
    expect(byGst?.matchedOn).toBe("gstin");
    expect(byGst?.org.id).toBe(ORG_A);

    // Same name (case-insensitive), different/empty GSTIN => matched on name.
    const byName = await findDuplicateOrganization(null, "atlas university");
    expect(byName?.matchedOn).toBe("name");
    expect(byName?.org.id).toBe(ORG_A);

    // A legitimately separate organization (ISDI): different name AND GSTIN => allowed.
    expect(await findDuplicateOrganization("33CCCCC0000C1Z5", "ISDI")).toBeNull();
    expect(await findDuplicateOrganization(null, "ISDI")).toBeNull();

    // Multiple legitimate orgs coexist and are listed.
    const orgs = await listOrganizationsBrief();
    expect(orgs.map((o) => o.id).sort()).toEqual([ORG_A, ORG_B].sort());
  });

  it("duplicate guard: normalizes GSTIN (trim/upper) and allows a same-NAME org when GSTINs differ", async () => {
    // GSTIN normalization — lowercase + padded input still matches the stored one.
    const norm = await findDuplicateOrganization("  27aaaaa0000a1z5  ", "Whatever Ltd");
    expect(norm?.matchedOn).toBe("gstin");
    expect(norm?.org.id).toBe(ORG_A);

    // Same NAME as Atlas but a DIFFERENT GSTIN => genuinely separate entity => ALLOWED.
    expect(await findDuplicateOrganization("33CCCCC0000C1Z5", "Atlas University")).toBeNull();

    // Same NAME and the new org has NO GSTIN => ambiguous => blocked on name.
    const ambiguous = await findDuplicateOrganization(null, "atlas university");
    expect(ambiguous?.matchedOn).toBe("name");

    // Same NAME as an existing org that has NO GSTIN => ambiguous => blocked on name.
    await iExecute("INSERT INTO `organizations` (`id`,`name`,`gstin`,`base_currency`) VALUES ('orgZ','Zeta Corp',NULL,'INR')");
    const vsNullGstin = await findDuplicateOrganization("44DDDDD0000D1Z5", "Zeta Corp");
    expect(vsNullGstin?.matchedOn).toBe("name");
    expect(vsNullGstin?.org.id).toBe("orgZ");
  });

  it("DB-level protection (migration 009): two orgs cannot share a GSTIN; NULL GSTINs are allowed", async () => {
    // The unique index exists.
    const idx = await iQueryOne<{ c: number }>(
      "SELECT COUNT(*) c FROM information_schema.STATISTICS WHERE table_schema=DATABASE() AND table_name='organizations' AND index_name='organizations_gstin_key'",
    );
    expect(Number(idx?.c)).toBeGreaterThan(0);

    // A second org with Atlas's GSTIN is rejected at the database level (race-safe).
    await expect(
      iExecute("INSERT INTO `organizations` (`id`,`name`,`gstin`,`base_currency`) VALUES ('dupA','Atlas Dup',?, 'INR')", [GSTIN_A]),
    ).rejects.toThrow(/duplicate entry/i);

    // Multiple organizations WITHOUT a GSTIN are allowed (NULLs aren't unique-constrained).
    await iExecute("INSERT INTO `organizations` (`id`,`name`,`gstin`,`base_currency`) VALUES ('n1','No GST One',NULL,'INR')");
    await iExecute("INSERT INTO `organizations` (`id`,`name`,`gstin`,`base_currency`) VALUES ('n2','No GST Two',NULL,'INR')");
    const nulls = await iQueryOne<{ c: number }>("SELECT COUNT(*) c FROM `organizations` WHERE `gstin` IS NULL");
    expect(Number(nulls?.c)).toBeGreaterThanOrEqual(2);
  });

  it("uniqueness status: reports ENFORCED when the index is present", async () => {
    const st = await getGstinUniquenessStatus();
    expect(st.enforced).toBe(true); // migration 009 added it on a clean DB
    expect(st.duplicateGroups).toBe(0);
  });

  it("uniqueness status: reports NOT enforced (with duplicate count) when the index was skipped", async () => {
    // Simulate the deploy state where duplicates pre-exist and 009 skipped the index.
    await iExecute("ALTER TABLE `organizations` DROP INDEX `organizations_gstin_key`");
    try {
      await iExecute("INSERT INTO `organizations` (`id`,`name`,`gstin`,`base_currency`) VALUES ('dupX','Dup X',?, 'INR')", [GSTIN_A]);
      const st = await getGstinUniquenessStatus();
      // The app must NOT claim enforcement that isn't there.
      expect(st.enforced).toBe(false);
      expect(st.duplicateGroups).toBeGreaterThanOrEqual(1);
    } finally {
      // Restore a clean state for later tests: remove the duplicate + re-add index.
      await iExecute("DELETE FROM `organizations` WHERE id='dupX'");
      await iExecute("ALTER TABLE `organizations` ADD UNIQUE INDEX `organizations_gstin_key` (`gstin`)").catch(() => undefined);
    }
  });
});
