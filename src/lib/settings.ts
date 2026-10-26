import "server-only";
import { execute, queryOne } from "./db";
import type { AppSettings } from "./models";

const DEFAULTS: AppSettings = {
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
 * Idempotent (INSERT ... ON DUPLICATE KEY) and safe under concurrent
 * prerendering; falls back to in-memory defaults if the DB is unavailable.
 */
export async function getSettings(): Promise<AppSettings> {
  try {
    await execute(
      "INSERT INTO `AppSettings` (`id`) VALUES ('app') ON DUPLICATE KEY UPDATE `id` = `id`",
    );
    const row = await queryOne<AppSettings>(
      "SELECT * FROM `AppSettings` WHERE `id` = ?",
      ["app"],
    );
    return row ?? DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export type AppSettingsRecord = AppSettings;
