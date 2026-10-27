/**
 * Authorized, local recovery / bootstrap for the designated administrator.
 * Run with: `npm run grant-admin [email] [name]`
 *
 * This is the documented recovery procedure for the case where the normal
 * Google sign-in bootstrap cannot run — e.g. an admin already exists, or you
 * are locked out. It requires shell access to the server, so it is NOT a
 * web-exposed path and cannot be triggered by "entering an email in a form".
 *
 * Defaults to the designated BOOTSTRAP_ADMIN_EMAIL. It creates the user if
 * absent (no password — Google proves identity at sign-in) or promotes an
 * existing user to active admin, and records an audit entry. It never deletes
 * or demotes anyone else.
 */
import { loadEnvConfig } from "@next/env";
import mysql from "mysql2/promise";
import { BOOTSTRAP_ADMIN_EMAIL } from "../src/lib/auth/constants";
import { getConnectionConfig } from "../src/lib/db-config";
import { createId } from "../src/lib/id";

// Load .env so DB_* / DATABASE_URL are available before connecting.
loadEnvConfig(process.cwd());

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  const email = (process.argv[2] ?? BOOTSTRAP_ADMIN_EMAIL).trim().toLowerCase();
  const name = process.argv[3] ?? "Administrator";
  if (!isValidEmail(email)) {
    console.error(`Invalid email: ${email}`);
    process.exitCode = 1;
    return;
  }

  // Connect directly (don't import src/lib/db.ts — it is server-only and
  // cannot be loaded from a standalone script).
  const conn = await mysql.createConnection(getConnectionConfig());
  try {
    const [rows] = await conn.query("SELECT `id` FROM `User` WHERE `email` = ?", [email]);
    const existing = (rows as { id: string }[])[0];
    let userId: string;
    if (existing) {
      await conn.query("UPDATE `User` SET `role`='admin', `status`='active' WHERE `email` = ?", [email]);
      userId = existing.id;
      console.log(`Promoted existing user to active admin: ${email}`);
    } else {
      userId = createId();
      await conn.query(
        "INSERT INTO `User` (`id`,`email`,`name`,`role`,`status`) VALUES (?,?,?,'admin','active')",
        [userId, email, name],
      );
      console.log(`Created active admin: ${email}`);
    }

    await conn.query(
      "INSERT INTO `AdminAuditLog` (`id`,`actorEmail`,`action`,`targetUserId`,`targetEmail`,`metadata`) VALUES (?,?,?,?,?,?)",
      [
        createId(),
        email,
        "user.role_changed",
        userId,
        email,
        JSON.stringify({ to: "admin", status: "active", via: "cli-grant-admin" }),
      ],
    );

    console.log("Done. Sign in at /login with Google using this email.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("grant-admin failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
