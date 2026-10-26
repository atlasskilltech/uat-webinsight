"use server";

import { revalidatePath } from "next/cache";
import { queryOne, execute, transaction, json } from "@/lib/db";
import { createId } from "@/lib/id";
import type { WebsitePage, AuditFinding, PageAudit } from "@/lib/models";
import { crawlPage } from "@/lib/crawler";
import { fetchPageSpeed } from "@/lib/google";
import { runDiagnostics } from "@/lib/diagnostics";
import { getSeoWithComparison, getAnalyticsSummary } from "@/lib/metrics";
import { lastNDays } from "@/lib/dates";
import { successState, errorState, type FormState } from "@/lib/form-state";

export async function runAudit(_prev: FormState, formData: FormData): Promise<FormState> {
  const url = String(formData.get("url") ?? "").trim();
  const runPsi = formData.get("runPsi") === "on";
  if (!url) return errorState("Enter a URL to inspect.");
  try {
    new URL(url);
  } catch {
    return errorState("That doesn't look like a valid URL (include https://).");
  }

  try {
    const crawl = await crawlPage(url);

    // Match a known page to pull its search/visitor metrics.
    const page = await queryOne<WebsitePage>("SELECT * FROM `WebsitePage` WHERE `url`=?", [url]);
    const range = lastNDays(28);
    const [seoCmp, analytics] = page
      ? await Promise.all([
          getSeoWithComparison(range, { pageId: page.id }),
          getAnalyticsSummary(range, { pageId: page.id }),
        ])
      : [null, null];

    const psi = runPsi ? await fetchPageSpeed(url) : null;

    const findings = runDiagnostics({
      url,
      crawl,
      psi,
      seo: seoCmp?.current ?? null,
      seoDelta: seoCmp ? { clicks: { value: seoCmp.delta.clicks.value, direction: seoCmp.delta.clicks.direction } } : null,
      analytics: analytics?.hasData ? { engagementRate: analytics.engagementRate, activeUsers: analytics.activeUsers, hasData: true } : null,
    });

    const notes = !crawl.ok ? crawl.error : crawl.error ? crawl.error : null;

    const auditId = await transaction(async (conn) => {
      const id = createId();
      await conn.query(
        "INSERT INTO `PageAudit` (`id`,`url`,`pageId`,`httpStatus`,`indexable`,`robots`,`canonical`,`title`,`titleLength`,`metaDescription`,`metaDescLength`,`h1`,`headingStructure`,`imagesTotal`,`imagesMissingAlt`,`internalLinks`,`externalLinks`,`structuredData`,`wordCount`,`performanceScore`,`accessibilityScore`,`seoScore`,`lcp`,`cls`,`inp`,`fetchedHtml`,`psiFetched`,`notes`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          id,
          url,
          page?.id ?? null,
          crawl.httpStatus ?? null,
          crawl.indexable ?? "unknown",
          crawl.robots ?? null,
          crawl.canonical ?? null,
          crawl.title ?? null,
          crawl.titleLength ?? null,
          crawl.metaDescription ?? null,
          crawl.metaDescLength ?? null,
          crawl.h1 ?? null,
          json(crawl.headingStructure ?? null),
          crawl.imagesTotal ?? null,
          crawl.imagesMissingAlt ?? null,
          crawl.internalLinks ?? null,
          crawl.externalLinks ?? null,
          json(crawl.structuredData ?? null),
          crawl.wordCount ?? null,
          psi?.performanceScore ?? null,
          psi?.accessibilityScore ?? null,
          psi?.seoScore ?? null,
          psi?.lcp ?? null,
          psi?.cls ?? null,
          psi?.inp ?? null,
          crawl.ok && !!crawl.title,
          !!psi?.fetched,
          notes,
        ],
      );

      if (findings.length > 0) {
        const rows = findings.map((f) => [
          createId(),
          id,
          f.detected,
          f.evidence ?? null,
          f.why ?? null,
          f.confidence,
          f.recommendation ?? null,
          f.priority,
          f.owner ?? null,
          f.status,
          f.verificationSteps ?? null,
          f.isHypothesis,
        ]);
        await conn.query(
          "INSERT INTO `AuditFinding` (`id`,`auditId`,`detected`,`evidence`,`why`,`confidence`,`recommendation`,`priority`,`owner`,`status`,`verificationSteps`,`isHypothesis`) VALUES ?",
          [rows],
        );
      }

      return id;
    });

    revalidatePath("/inspector");
    return successState(
      crawl.ok ? `Audit complete — ${findings.length} finding(s).` : `Audited with limited data: ${crawl.error}`,
      auditId,
    );
  } catch {
    return errorState("The audit failed unexpectedly. Please try again.");
  }
}

export async function deleteAudit(id: string): Promise<void> {
  await execute("DELETE FROM `PageAudit` WHERE `id`=?", [id]);
  revalidatePath("/inspector");
}

/** Promote a diagnostic finding into the Technical SEO Issues register. */
export async function createIssueFromFinding(findingId: string): Promise<FormState> {
  const finding = await queryOne<AuditFinding>("SELECT * FROM `AuditFinding` WHERE `id`=?", [findingId]);
  if (!finding) return errorState("Finding not found.");
  const audit = await queryOne<PageAudit>("SELECT * FROM `PageAudit` WHERE `id`=?", [finding.auditId]);
  if (!audit) return errorState("Finding not found.");
  try {
    await execute(
      "INSERT INTO `TechnicalIssue` (`id`,`title`,`urls`,`category`,`severity`,`priority`,`evidence`,`source`,`impact`,`recommendedFix`,`status`,`approvalStatus`,`auditId`,`pageId`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        createId(),
        finding.detected,
        json([audit.url]),
        "other",
        finding.priority === "critical" ? "critical" : finding.priority === "high" ? "high" : finding.priority === "low" ? "low" : "medium",
        finding.priority,
        finding.evidence,
        "Page Inspector",
        finding.why,
        finding.recommendation,
        "open",
        "pending",
        finding.auditId,
        audit.pageId,
      ],
    );
    revalidatePath("/issues");
    return successState("Issue created in the register.");
  } catch {
    return errorState("Could not create the issue.");
  }
}
