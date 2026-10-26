"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
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
    const page = await prisma.websitePage.findUnique({ where: { url } });
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

    const audit = await prisma.pageAudit.create({
      data: {
        url,
        pageId: page?.id ?? null,
        httpStatus: crawl.httpStatus ?? null,
        indexable: crawl.indexable ?? "unknown",
        robots: crawl.robots ?? null,
        canonical: crawl.canonical ?? null,
        title: crawl.title ?? null,
        titleLength: crawl.titleLength ?? null,
        metaDescription: crawl.metaDescription ?? null,
        metaDescLength: crawl.metaDescLength ?? null,
        h1: crawl.h1 ?? null,
        headingStructure: crawl.headingStructure ?? undefined,
        imagesTotal: crawl.imagesTotal ?? null,
        imagesMissingAlt: crawl.imagesMissingAlt ?? null,
        internalLinks: crawl.internalLinks ?? null,
        externalLinks: crawl.externalLinks ?? null,
        structuredData: crawl.structuredData ?? undefined,
        wordCount: crawl.wordCount ?? null,
        performanceScore: psi?.performanceScore ?? null,
        accessibilityScore: psi?.accessibilityScore ?? null,
        seoScore: psi?.seoScore ?? null,
        lcp: psi?.lcp ?? null,
        cls: psi?.cls ?? null,
        inp: psi?.inp ?? null,
        fetchedHtml: crawl.ok && !!crawl.title,
        psiFetched: !!psi?.fetched,
        notes,
        findings: {
          create: findings.map((f) => ({
            detected: f.detected,
            evidence: f.evidence,
            why: f.why,
            confidence: f.confidence,
            recommendation: f.recommendation,
            priority: f.priority,
            owner: f.owner,
            status: f.status,
            verificationSteps: f.verificationSteps,
            isHypothesis: f.isHypothesis,
          })),
        },
      },
    });

    revalidatePath("/inspector");
    return successState(
      crawl.ok ? `Audit complete — ${findings.length} finding(s).` : `Audited with limited data: ${crawl.error}`,
      audit.id,
    );
  } catch {
    return errorState("The audit failed unexpectedly. Please try again.");
  }
}

export async function deleteAudit(id: string): Promise<void> {
  await prisma.pageAudit.delete({ where: { id } });
  revalidatePath("/inspector");
}

/** Promote a diagnostic finding into the Technical SEO Issues register. */
export async function createIssueFromFinding(findingId: string): Promise<FormState> {
  const finding = await prisma.auditFinding.findUnique({
    where: { id: findingId },
    include: { audit: true },
  });
  if (!finding) return errorState("Finding not found.");
  try {
    await prisma.technicalIssue.create({
      data: {
        title: finding.detected,
        urls: [finding.audit.url],
        category: "other",
        severity: finding.priority === "critical" ? "critical" : finding.priority === "high" ? "high" : finding.priority === "low" ? "low" : "medium",
        priority: finding.priority,
        evidence: finding.evidence,
        source: "Page Inspector",
        impact: finding.why,
        recommendedFix: finding.recommendation,
        status: "open",
        approvalStatus: "pending",
        auditId: finding.auditId,
        pageId: finding.audit.pageId,
      },
    });
    revalidatePath("/issues");
    return successState("Issue created in the register.");
  } catch {
    return errorState("Could not create the issue.");
  }
}
