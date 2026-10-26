/**
 * MySQL connection settings for mysql2.
 *
 * Configure EITHER with the individual DB_* variables (the style used across
 * our other apps) OR a single DATABASE_URL. DB_* is preferred; a DATABASE_URL
 * is parsed when the parts aren't given.
 *   DB_HOST, DB_PORT (default 3306), DB_USER, DB_PASSWORD, DB_NAME
 *   DATABASE_URL="mysql://user:password@host:3306/dbname"
 */
export interface DbConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function getConnectionConfig(): DbConnectionConfig {
  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const name = process.env.DB_NAME?.trim();
  if (host && user && name) {
    return {
      host,
      port: Number(process.env.DB_PORT?.trim() || "3306"),
      user,
      password: process.env.DB_PASSWORD ?? "",
      database: name,
    };
  }

  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || "3306"),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
    };
  }

  throw new Error(
    "Database is not configured. Set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME " +
      "(DB_PORT optional, defaults to 3306), or a single DATABASE_URL.",
  );
}
