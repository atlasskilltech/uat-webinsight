import "server-only";
import mysql from "mysql2/promise";
import { getConnectionConfig } from "./db-config";

/**
 * Raw MySQL access via mysql2 (replaces Prisma). A single pooled connection is
 * reused across hot reloads in development. Helpers return plain row objects.
 *
 * Type handling:
 *  - TINYINT(1) columns are cast to real booleans (so `isDemo`, `archived`,
 *    etc. behave like the old Prisma booleans).
 *  - JSON columns are parsed to objects by mysql2 on read; write JSON with
 *    JSON.stringify(...) (see the model helpers).
 *  - DATETIME columns are returned as JS Date objects.
 */
const globalForDb = globalThis as unknown as { __pool?: mysql.Pool };

/**
 * Lazily create (and memoize) the connection pool on first use. Lazy creation
 * means importing this module never reads DB_* / connects — which lets the
 * standalone scripts load .env first, and avoids build-time connections.
 */
export function getPool(): mysql.Pool {
  if (globalForDb.__pool) return globalForDb.__pool;
  const pool = mysql.createPool({
    ...getConnectionConfig(),
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    enableKeepAlive: true,
    timezone: "Z",
    typeCast(field, next) {
      // TINYINT(1) -> boolean
      if (field.type === "TINY" && field.length === 1) {
        const v = field.string();
        return v === null ? null : v === "1";
      }
      return next();
    },
  });
  globalForDb.__pool = pool;
  return pool;
}

/** Run a SELECT (or any query) and return all rows. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await getPool().query(sql, params);
  return rows as T[];
}

/** Run a query and return the first row, or null. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Run an INSERT/UPDATE/DELETE and return the result header (affectedRows, etc.). */
export async function execute(
  sql: string,
  params: unknown[] = [],
): Promise<mysql.ResultSetHeader> {
  const [res] = await getPool().query(sql, params);
  return res as mysql.ResultSetHeader;
}

/**
 * Run several statements atomically. The callback receives a dedicated
 * connection; use conn.query(...) for every statement inside it.
 */
export async function transaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await getPool().getConnection();
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
export function json(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}
