import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./db-url";

// Reuse a single PrismaClient across hot reloads in development to avoid
// exhausting database connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Built from DATABASE_URL, or composed from DB_HOST/DB_USER/DB_PASSWORD/
    // DB_NAME/DB_PORT (see src/lib/db-url.ts).
    datasourceUrl: resolveDatabaseUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
