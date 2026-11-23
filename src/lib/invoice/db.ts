import "server-only";
import mysql from "mysql2/promise";
import { getInvoiceDbConfig } from "./config";

/**
 * Raw MySQL access for the Atlas Invoice Agent — a DEDICATED pool against the
 * `atlas_invoice` database, completely separate from the main app's pool in
 * src/lib/db.ts. No ORM. Parameterized queries only. Transactions via
 * iTransaction(). Mirrors the house conventions (TINYINT(1)->boolean, JSON
 * parsing, UTC timezone).
 */
const globalForInvoiceDb = globalThis as unknown as { __invoicePool?: mysql.Pool };

// JSON columns across the invoice schema (parsed by name to also cover MariaDB,
// where JSON is stored as LONGTEXT and not auto-parsed).
const JSON_COLUMNS = new Set([
  "address",
  "settings",
  "billing_address",
  "shipping_address",
  "raw_json",
  "field_confidence",
  "field_sources",
  "payload",
  "result",
  "reason",
  "policy_snapshot",
  "recurring_items",
  "tax_config",
  "before",
  "after",
  "metadata",
  "rules",
  "plan",
  "tool_calls",
  "arguments",
  "output",
  "data",
  "value",
]);

export function getInvoicePool(): mysql.Pool {
  if (globalForInvoiceDb.__invoicePool) return globalForInvoiceDb.__invoicePool;
  const pool = mysql.createPool({
    ...getInvoiceDbConfig(),
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    enableKeepAlive: true,
    timezone: "Z",
    supportBigNumbers: true,
    decimalNumbers: false, // keep DECIMAL as strings — never parse money through JS float
    typeCast(field, next) {
      if (field.type === "TINY" && field.length === 1) {
        const v = field.string();
        return v === null ? null : v === "1";
      }
      if (field.type === "JSON" || JSON_COLUMNS.has(field.name)) {
        const v = field.string("utf8");
        if (v === null) return null;
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      }
      return next();
    },
  });
  globalForInvoiceDb.__invoicePool = pool;
  return pool;
}

export async function iQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await getInvoicePool().query(sql, params);
  return rows as T[];
}

export async function iQueryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await iQuery<T>(sql, params);
  return rows[0] ?? null;
}

export async function iExecute(
  sql: string,
  params: unknown[] = [],
): Promise<mysql.ResultSetHeader> {
  const [res] = await getInvoicePool().query(sql, params);
  return res as mysql.ResultSetHeader;
}

/** Run several statements atomically against the invoice DB. */
export async function iTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getInvoicePool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Serialize a value for a JSON column (null stays null). */
export function ijson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * True when an error is MySQL's "table doesn't exist" (ER_NO_SUCH_TABLE / errno
 * 1146). Lets read paths degrade gracefully when the invoice DB is reachable but
 * a newer migration has not been applied yet (deploy and `invoice:db:init` are
 * separate steps), instead of throwing an unhandled server-side exception.
 */
export function isMissingTableError(e: unknown): boolean {
  const err = e as { code?: string; errno?: number } | null;
  return Boolean(err && (err.code === "ER_NO_SUCH_TABLE" || err.errno === 1146));
}
