import "server-only";
import { prisma } from "./prisma";

// --- Minimal, dependency-free CSV parser (handles quotes + CRLF) ------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushRow();
    } else if (c === "\r") {
      // ignore; handled by \n
    } else {
      field += c;
    }
  }
  // flush trailing field/row
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function num(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[,%\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** CTR/engagement rate may be "3.5%" (→0.035) or "0.035" (→0.035). */
function ratio(raw: string | undefined): number | null {
  if (raw == null) return null;
  const isPct = raw.includes("%");
  const n = num(raw);
  if (n == null) return null;
  return isPct ? n / 100 : n > 1 ? n / 100 : n;
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  // yyyy-mm-dd
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  // dd/mm/yyyy or mm/dd/yyyy — assume dd/mm/yyyy (common in exports)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const idx = lower.indexOf(n.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

export interface ImportResult {
  ok: boolean;
  rowCount: number;
  skippedRows: number;
  message: string;
  batchId?: string;
}

async function resolvePageId(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  const page = await prisma.websitePage.findUnique({ where: { url } });
  return page?.id ?? null;
}

/**
 * Import a Google Search Console CSV export.
 * Recognised columns (case-insensitive): date, page|url|landing page|top pages,
 * clicks, impressions, ctr, position|average position. A `date` column yields
 * daily rows; otherwise rows are per-page for the supplied period.
 */
export async function importSeoCsv(
  text: string,
  opts: { propertyId: string; fileName?: string; periodStart?: Date; periodEnd?: Date },
): Promise<ImportResult> {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, rowCount: 0, skippedRows: 0, message: "No data rows found." };
  const headers = rows[0];
  const iDate = headerIndex(headers, "date");
  const iPage = headerIndex(headers, "page", "url", "landing page", "top pages", "address");
  const iClicks = headerIndex(headers, "clicks", "url clicks");
  const iImpr = headerIndex(headers, "impressions");
  const iCtr = headerIndex(headers, "ctr", "click through rate");
  const iPos = headerIndex(headers, "position", "average position", "avg. position");

  if (iClicks < 0 && iImpr < 0) {
    return { ok: false, rowCount: 0, skippedRows: 0, message: "Could not find 'Clicks' or 'Impressions' columns. Check the file format." };
  }

  const data = rows.slice(1);
  let skipped = 0;
  const toCreate: Parameters<typeof prisma.seoSnapshot.create>[0]["data"][] = [];

  for (const r of data) {
    const date = iDate >= 0 ? parseDate(r[iDate]) : null;
    const start = date ?? opts.periodStart;
    const end = date ?? opts.periodEnd;
    if (!start || !end) {
      skipped++;
      continue;
    }
    const clicks = num(r[iClicks]) ?? 0;
    const impressions = num(r[iImpr]) ?? 0;
    const pageUrl = iPage >= 0 ? r[iPage]?.trim() : undefined;
    const pageId = await resolvePageId(pageUrl);
    toCreate.push({
      propertyId: opts.propertyId,
      source: "gsc",
      startDate: start,
      endDate: end,
      clicks,
      impressions,
      ctr: ratio(r[iCtr]) ?? (impressions > 0 ? clicks / impressions : 0),
      position: num(r[iPos]) ?? 0,
      pageId,
      isDemo: false,
    });
  }

  if (toCreate.length === 0) {
    return { ok: false, rowCount: 0, skippedRows: skipped, message: "No valid rows could be imported (missing dates or metrics)." };
  }

  const batch = await prisma.importBatch.create({
    data: {
      source: "gsc",
      fileName: opts.fileName,
      rowCount: toCreate.length,
      skippedRows: skipped,
      propertyId: opts.propertyId,
      periodStart: opts.periodStart ?? null,
      periodEnd: opts.periodEnd ?? null,
      status: skipped > 0 ? "partial" : "completed",
      isDemo: false,
    },
  });
  await prisma.seoSnapshot.createMany({
    data: toCreate.map((d) => ({ ...d, importBatchId: batch.id })),
  });
  return {
    ok: true,
    rowCount: toCreate.length,
    skippedRows: skipped,
    message: `Imported ${toCreate.length} Search Console rows${skipped ? `, skipped ${skipped}` : ""}.`,
    batchId: batch.id,
  };
}

/**
 * Import a Google Analytics 4 CSV export.
 * Recognised columns: date, page|page path|landing page, views|screen page views,
 * active users|users, sessions, engaged sessions, engagement rate,
 * average engagement time.
 */
export async function importAnalyticsCsv(
  text: string,
  opts: { propertyId: string; fileName?: string; periodStart?: Date; periodEnd?: Date },
): Promise<ImportResult> {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, rowCount: 0, skippedRows: 0, message: "No data rows found." };
  const headers = rows[0];
  const iDate = headerIndex(headers, "date");
  const iPage = headerIndex(headers, "page", "page path", "page path and screen class", "landing page", "url");
  const iViews = headerIndex(headers, "views", "screen page views", "page views", "pageviews");
  const iUsers = headerIndex(headers, "active users", "users", "total users");
  const iSessions = headerIndex(headers, "sessions");
  const iEngaged = headerIndex(headers, "engaged sessions");
  const iRate = headerIndex(headers, "engagement rate");
  const iTime = headerIndex(headers, "average engagement time", "average engagement time per session", "avg engagement time");

  if (iViews < 0 && iUsers < 0) {
    return { ok: false, rowCount: 0, skippedRows: 0, message: "Could not find 'Views' or 'Active users' columns. Check the file format." };
  }

  const data = rows.slice(1);
  let skipped = 0;
  const toCreate: Parameters<typeof prisma.analyticsSnapshot.create>[0]["data"][] = [];

  for (const r of data) {
    const date = iDate >= 0 ? parseDate(r[iDate]) : null;
    const start = date ?? opts.periodStart;
    const end = date ?? opts.periodEnd;
    if (!start || !end) {
      skipped++;
      continue;
    }
    const sessions = num(r[iSessions]) ?? 0;
    const engaged = num(r[iEngaged]) ?? 0;
    const pageUrl = iPage >= 0 ? r[iPage]?.trim() : undefined;
    const pageId = await resolvePageId(pageUrl);
    toCreate.push({
      propertyId: opts.propertyId,
      source: "ga4",
      startDate: start,
      endDate: end,
      views: num(r[iViews]) ?? 0,
      activeUsers: num(r[iUsers]) ?? 0,
      sessions,
      engagedSessions: engaged,
      engagementRate: ratio(r[iRate]) ?? (sessions > 0 ? engaged / sessions : 0),
      avgEngagementSecs: num(r[iTime]) ?? 0,
      pageId,
      isDemo: false,
    });
  }

  if (toCreate.length === 0) {
    return { ok: false, rowCount: 0, skippedRows: skipped, message: "No valid rows could be imported (missing dates or metrics)." };
  }

  const batch = await prisma.importBatch.create({
    data: {
      source: "ga4",
      fileName: opts.fileName,
      rowCount: toCreate.length,
      skippedRows: skipped,
      propertyId: opts.propertyId,
      periodStart: opts.periodStart ?? null,
      periodEnd: opts.periodEnd ?? null,
      status: skipped > 0 ? "partial" : "completed",
      isDemo: false,
    },
  });
  await prisma.analyticsSnapshot.createMany({
    data: toCreate.map((d) => ({ ...d, importBatchId: batch.id })),
  });
  return {
    ok: true,
    rowCount: toCreate.length,
    skippedRows: skipped,
    message: `Imported ${toCreate.length} Analytics rows${skipped ? `, skipped ${skipped}` : ""}.`,
    batchId: batch.id,
  };
}
