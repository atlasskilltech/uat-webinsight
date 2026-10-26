import { defineConfig } from "prisma/config";
import { loadEnvConfig } from "@next/env";
import { tryBuildDatabaseUrl } from "./src/lib/db-url";

// With a Prisma config file present, Prisma no longer auto-loads .env, so load
// it ourselves using the same loader Next.js uses (keeps values identical).
loadEnvConfig(process.cwd());

// Let the Prisma CLI (generate / migrate / studio) use DB_HOST/DB_USER/...
// like our other apps: compose DATABASE_URL from those parts when it isn't set
// explicitly. The schema's datasource reads env("DATABASE_URL").
const composed = tryBuildDatabaseUrl();
if (composed) process.env.DATABASE_URL = composed;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
