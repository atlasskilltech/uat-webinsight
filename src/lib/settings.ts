import "server-only";
import { prisma } from "./prisma";

const DEFAULTS = {
  id: "app",
  siteUrl: "https://atlasuniversity.edu.in/",
  siteName: "Atlas University",
  ownerName: "",
  ownerEmail: "",
  timezone: "Asia/Kolkata",
  gscProperty: "",
  ga4Property: "",
  updatedAt: new Date(),
};

/**
 * Read the singleton app settings, creating the default row if absent.
 * Uses upsert so it is idempotent and safe under concurrent prerendering,
 * and falls back to in-memory defaults if the DB is unavailable.
 */
export async function getSettings() {
  try {
    return await prisma.appSettings.upsert({
      where: { id: "app" },
      update: {},
      create: { id: "app" },
    });
  } catch {
    return DEFAULTS;
  }
}

export type AppSettingsRecord = Awaited<ReturnType<typeof getSettings>>;
