import "server-only";
import { queryOne } from "./db";

/**
 * A "data scope" decides whether a view shows REAL records or DEMO (seeded)
 * records — never a mix of the two. Each domain resolves its own scope
 * independently: a domain becomes "real" as soon as it has at least one
 * non-demo row, otherwise it stays "demo" so the seeded sample data remains
 * visible until real data arrives.
 *
 * Consequence: once a domain has any real data, its seeded demo rows are
 * hidden by default. A date range that contains only demo rows will then show
 * an honest "no data" state rather than silently falling back to demo figures.
 */
export type DataScope = "real" | "demo";

/** Turn a count of real (non-demo) rows into a scope. */
function scopeFromRealCount(realCount: number): DataScope {
  return realCount > 0 ? "real" : "demo";
}

/**
 * The value to use in an `isDemo =` filter for a given scope.
 *   real -> isDemo = false  (return only real rows)
 *   demo -> isDemo = true   (return only seeded demo rows)
 * Using this in a WHERE clause guarantees a single query can never return
 * demo and real rows together.
 */
export function demoFilter(scope: DataScope): boolean {
  return scope === "demo";
}

/** Count non-demo (real) rows in a table. Table name is a trusted literal. */
async function countReal(table: string): Promise<number> {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM \`${table}\` WHERE isDemo = ?`,
    [false],
  );
  return Number(row?.c ?? 0);
}

/** SEO + GA4 are treated as one domain: real if either has any real row. */
export async function metricsScope(): Promise<DataScope> {
  const [seo, ga] = await Promise.all([
    countReal("SeoSnapshot"),
    countReal("AnalyticsSnapshot"),
  ]);
  return scopeFromRealCount(seo + ga);
}

export async function taskScope(): Promise<DataScope> {
  return scopeFromRealCount(await countReal("Task"));
}

export async function workLogScope(): Promise<DataScope> {
  return scopeFromRealCount(await countReal("WorkLog"));
}

export async function issueScope(): Promise<DataScope> {
  return scopeFromRealCount(await countReal("TechnicalIssue"));
}

export async function operationsScope(): Promise<DataScope> {
  return scopeFromRealCount(await countReal("OperationsLog"));
}

export async function competitorScope(): Promise<DataScope> {
  return scopeFromRealCount(await countReal("CompetitorResearch"));
}
