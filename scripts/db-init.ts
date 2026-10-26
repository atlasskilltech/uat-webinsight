/**
 * Create the database schema from db/schema.sql.
 * Run once against an empty (or existing) database:  npm run db:init
 * Uses CREATE TABLE IF NOT EXISTS, so re-running is safe and additive.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadEnvConfig } from "@next/env";
import { getConnectionConfig } from "../src/lib/db-config";

loadEnvConfig(process.cwd());

async function main() {
  const sql = readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  const conn = await mysql.createConnection({
    ...getConnectionConfig(),
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    console.log("Schema applied from db/schema.sql.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("db:init failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
