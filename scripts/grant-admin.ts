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
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { BOOTSTRAP_ADMIN_EMAIL } from "../src/lib/auth/constants";
import { resolveDatabaseUrl } from "../src/lib/db-url";

// Load .env so DATABASE_URL / DB_* are available when run directly via tsx.
loadEnvConfig(process.cwd());

const prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });

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

  const existing = await prisma.user.findUnique({ where: { email } });
  let userId: string;
  if (existing) {
    const updated = await prisma.user.update({
      where: { email },
      data: { role: "admin", status: "active" },
    });
    userId = updated.id;
    console.log(`Promoted existing user to active admin: ${email}`);
  } else {
    const created = await prisma.user.create({
      data: { email, name, role: "admin", status: "active" },
    });
    userId = created.id;
    console.log(`Created active admin: ${email}`);
  }

  await prisma.adminAuditLog.create({
    data: {
      actorEmail: email,
      action: "user.role_changed",
      targetUserId: userId,
      targetEmail: email,
      metadata: { to: "admin", status: "active", via: "cli-grant-admin" },
    },
  });

  console.log("Done. Sign in at /login with Google using this email.");
}

main()
  .catch((e) => {
    console.error("grant-admin failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
