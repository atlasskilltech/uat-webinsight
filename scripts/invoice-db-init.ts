/**
 * Create / migrate the dedicated `atlas_invoice` database.
 *
 *   npm run invoice:db:init
 *
 * - Connects with the invoice DB credentials (INVOICE_* or fallback to DB_*).
 * - Creates the database if it does not exist.
 * - Applies every db/invoice/*.sql file, in filename order, exactly once.
 * - Records applied files in `_invoice_migrations`, so re-running is safe and
 *   only new files are applied. Does NOT touch the main `atlas_dashboard` DB.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadEnvConfig } from "@next/env";
import { getInvoiceDbConfig } from "../src/lib/invoice/config";

loadEnvConfig(process.cwd());

async function main() {
  const cfg = getInvoiceDbConfig();

  // 1. Ensure the database exists (connect without a database first).
  const admin = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    multipleStatements: true,
  });
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` ` +
        `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`[invoice:db:init] database ensured: ${cfg.database}`);
  } finally {
    await admin.end();
  }

  // 2. Connect to the database and apply migrations.
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  try {
    await conn.query(
      "CREATE TABLE IF NOT EXISTS `_invoice_migrations` (" +
        "`filename` VARCHAR(191) NOT NULL," +
        "`applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)," +
        "PRIMARY KEY (`filename`)" +
        ") ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    );

    const dir = path.join(process.cwd(), "db", "invoice");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const [appliedRows] = await conn.query("SELECT `filename` FROM `_invoice_migrations`");
    const applied = new Set((appliedRows as { filename: string }[]).map((r) => r.filename));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[invoice:db:init] skip (already applied): ${file}`);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), "utf8");
      await conn.query(sql);
      await conn.query("INSERT INTO `_invoice_migrations` (`filename`) VALUES (?)", [file]);
      console.log(`[invoice:db:init] applied: ${file}`);
      count += 1;
    }
    console.log(`[invoice:db:init] done. ${count} migration(s) applied, ${files.length} total.`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("[invoice:db:init] failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
