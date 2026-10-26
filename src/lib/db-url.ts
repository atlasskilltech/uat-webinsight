/**
 * Resolve the MySQL connection string for Prisma.
 *
 * Prisma needs a single `DATABASE_URL`. So this app can reuse the same
 * DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME variables used by our
 * other apps, the URL is built from those parts when `DATABASE_URL` is not set
 * explicitly. An explicit `DATABASE_URL` always takes priority.
 *
 * Shared by the runtime client (src/lib/prisma.ts), the standalone scripts
 * (prisma/seed.ts, scripts/grant-admin.ts) and the Prisma CLI (prisma.config.ts),
 * so every entry point builds the connection the same way.
 */

/** Build the URL, or return undefined when the parts aren't all present. */
export function tryBuildDatabaseUrl(): string | undefined {
  const explicit = process.env.DATABASE_URL?.trim();
  if (explicit) return explicit;

  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USER?.trim();
  const name = process.env.DB_NAME?.trim();
  if (!host || !user || !name) return undefined;

  const port = process.env.DB_PORT?.trim() || "3306";
  const password = process.env.DB_PASSWORD ?? "";
  // Encode so passwords/usernames with @ : / ? # etc. stay valid in the URL.
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `mysql://${auth}@${host}:${port}/${name}`;
}

/** Build the URL, or throw a clear error when the database isn't configured. */
export function resolveDatabaseUrl(): string {
  const url = tryBuildDatabaseUrl();
  if (url) return url;
  throw new Error(
    "Database is not configured. Set DATABASE_URL, or all of DB_HOST, DB_USER, " +
      "DB_PASSWORD and DB_NAME (DB_PORT is optional, defaults to 3306).",
  );
}
