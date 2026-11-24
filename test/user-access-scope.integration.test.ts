/**
 * MySQL-backed integration test for the Admin → User Management access-scope
 * action: an admin can grant / revoke Invoice-Agent-only access, the change
 * persists and is audited, and non-admins cannot do it. Uses a disposable DB;
 * the session loader is mocked (controls the acting admin and avoids loading
 * next-auth in the test).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mysql2 from "mysql2/promise";
import type { SafeUser } from "@/lib/auth/types";

const DB = {
  host: process.env.ITEST_DB_HOST || "127.0.0.1",
  port: Number(process.env.ITEST_DB_PORT || 3306),
  user: process.env.ITEST_DB_USER || "root",
  password: process.env.ITEST_DB_PASSWORD ?? "",
  name: process.env.ITEST_DB_NAME_USERACCESS || "atlas_useraccess_itest",
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
if (!READY) console.warn(`[user-access-scope.integration] no MySQL at ${DB.host}:${DB.port} — skipping.`);

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn<() => Promise<SafeUser | null>>() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { query, queryOne } from "@/lib/db";
import { setAccessScopeAction } from "@/app/admin/users/actions";

const admin = (over: Partial<SafeUser> = {}): SafeUser => ({
  id: "admin1", name: "Admin", email: "admin@atlas.test", role: "admin", status: "active",
  accessScope: "full", lastLoginAt: null, createdAt: new Date(0), ...over,
});

describe.skipIf(!READY)("user access-scope action — MySQL integration (disposable DB)", () => {
  beforeAll(async () => {
    const a = await mysql2.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, multipleStatements: true });
    await a.query(`DROP DATABASE IF EXISTS \`${DB.name}\``);
    await a.query(`CREATE DATABASE \`${DB.name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await a.query(`USE \`${DB.name}\``);
    await a.query(
      "CREATE TABLE `User` (`id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `email` VARCHAR(191) NOT NULL, " +
        "`role` VARCHAR(191) NOT NULL DEFAULT 'user', `status` VARCHAR(191) NOT NULL DEFAULT 'active', " +
        "`accessScope` VARCHAR(16) NOT NULL DEFAULT 'full', `passwordHash` VARCHAR(191) NULL, `lastLoginAt` DATETIME(3) NULL, " +
        "`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), " +
        "PRIMARY KEY (`id`), UNIQUE KEY `User_email_key` (`email`)) ENGINE=InnoDB",
    );
    await a.query(
      "CREATE TABLE `AdminAuditLog` (`id` VARCHAR(191) NOT NULL, `actorId` VARCHAR(191) NULL, `actorEmail` VARCHAR(191) NULL, " +
        "`action` VARCHAR(191) NOT NULL, `targetUserId` VARCHAR(191) NULL, `targetEmail` VARCHAR(191) NULL, `metadata` JSON NULL, " +
        "`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`)) ENGINE=InnoDB",
    );
    await a.end();

    const g = globalThis as unknown as { __pool?: { end?: () => Promise<void> } };
    await g.__pool?.end?.().catch(() => undefined);
    delete g.__pool;
    process.env.DB_HOST = DB.host;
    process.env.DB_PORT = String(DB.port);
    process.env.DB_USER = DB.user;
    process.env.DB_PASSWORD = DB.password;
    process.env.DB_NAME = DB.name;
  }, 60_000);

  afterAll(async () => {
    const g = globalThis as unknown as { __pool?: { end?: () => Promise<void> } };
    await g.__pool?.end?.().catch(() => undefined);
    delete g.__pool;
    const a = await mysql2.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password }).catch(() => null);
    if (a) {
      await a.query(`DROP DATABASE IF EXISTS \`${DB.name}\``).catch(() => undefined);
      await a.end().catch(() => undefined);
    }
  });

  beforeEach(async () => {
    const { execute } = await import("@/lib/db");
    await execute("DELETE FROM `User`");
    await execute("DELETE FROM `AdminAuditLog`");
    await execute("INSERT INTO `User` (`id`,`name`,`email`,`role`,`status`,`accessScope`) VALUES ('u_t','Target','target@atlas.test','user','active','full')");
    getCurrentUser.mockResolvedValue(admin());
  });

  const scopeOf = async () =>
    (await queryOne<{ accessScope: string }>("SELECT `accessScope` FROM `User` WHERE `id`='u_t'"))?.accessScope;

  it("an admin grants Invoice-Agent-only access; it persists and is audited", async () => {
    const res = await setAccessScopeAction("u_t", "invoice_only");
    expect(res.ok).toBe(true);
    expect(await scopeOf()).toBe("invoice_only");
    const audit = await queryOne<{ action: string; metadata: unknown }>(
      "SELECT `action`, `metadata` FROM `AdminAuditLog` WHERE `targetUserId`='u_t' ORDER BY `createdAt` DESC LIMIT 1",
    );
    expect(audit?.action).toBe("user.access_scope_changed");
  });

  it("an admin restores Full Access", async () => {
    await setAccessScopeAction("u_t", "invoice_only");
    const res = await setAccessScopeAction("u_t", "full");
    expect(res.ok).toBe(true);
    expect(await scopeOf()).toBe("full");
  });

  it("rejects an invalid scope value", async () => {
    const res = await setAccessScopeAction("u_t", "superuser" as "full");
    expect(res.ok).toBe(false);
    expect(await scopeOf()).toBe("full");
  });

  it("only authorized admins may change it — a non-admin is denied", async () => {
    getCurrentUser.mockResolvedValue(admin({ role: "user" }));
    const res = await setAccessScopeAction("u_t", "invoice_only");
    expect(res.ok).toBe(false);
    expect(await scopeOf()).toBe("full"); // unchanged
  });

  it("an invoice_only admin cannot change access scope (requireAdmin enforces full access)", async () => {
    getCurrentUser.mockResolvedValue(admin({ accessScope: "invoice_only" }));
    const res = await setAccessScopeAction("u_t", "invoice_only");
    expect(res.ok).toBe(false);
    expect(await scopeOf()).toBe("full");
  });
});
