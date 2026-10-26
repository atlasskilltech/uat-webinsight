import type { CrawlResult } from "./crawler";
import type { PsiResult } from "./google";

export interface DiagnosticFinding {
  detected: string;
  evidence?: string;
  why?: string;
  confidence: "high" | "medium" | "low";
  recommendation?: string;
  priority: "low" | "medium" | "high" | "critical";
  owner?: string;
  status: "open" | "investigating" | "hypothesis" | "confirmed";
  verificationSteps?: string;
  isHypothesis: boolean;
}

export interface DiagnosticInput {
  url: string;
  crawl: CrawlResult;
  psi?: PsiResult | null;
  seo?: { clicks: number; impressions: number; ctr: number; position: number; hasData: boolean } | null;
  seoDelta?: { clicks: { value: number | null; direction: string } } | null;
  analytics?: { engagementRate: number; activeUsers: number; hasData: boolean } | null;
}

/**
 * Interpret available evidence into findings. Deliberately conservative:
 * on-page facts (missing meta, status codes, alt text) are CONFIRMED; anything
 * inferred from traffic patterns is flagged as a HYPOTHESIS to investigate —
 * low traffic alone is never treated as proof of a defect.
 */
export function runDiagnostics(input: DiagnosticInput): DiagnosticFinding[] {
  const f: DiagnosticFinding[] = [];
  const { crawl, psi, seo, seoDelta, analytics } = input;
  const seoOwner = "SEO";
  const devOwner = "Web development";

  // --- Confirmed on-page facts ---------------------------------------------
  if (crawl.httpStatus && crawl.httpStatus >= 400) {
    f.push({
      detected: `Page returns HTTP ${crawl.httpStatus}`,
      evidence: `The URL responded with status ${crawl.httpStatus}.`,
      why: "Error pages cannot rank or serve visitors.",
      confidence: "high", priority: "critical", status: "confirmed", owner: devOwner,
      recommendation: "Fix the error or set up an appropriate redirect.",
      verificationSteps: "Re-request the URL and confirm a 200 response.",
      isHypothesis: false,
    });
  }
  if (crawl.redirected) {
    f.push({
      detected: "URL redirects to another address",
      evidence: `Request was redirected to ${crawl.finalUrl}.`,
      why: "Redirects can dilute signals and confuse indexing if unintended.",
      confidence: "high", priority: "low", status: "open", owner: seoOwner,
      recommendation: "Confirm the redirect target is intended and canonical.",
      verificationSteps: "Check the redirect chain is a single 301 to the preferred URL.",
      isHypothesis: false,
    });
  }
  if (crawl.indexable === "blocked" && /noindex/i.test(crawl.robots ?? "")) {
    f.push({
      detected: "Page is set to noindex",
      evidence: `Robots directive: "${crawl.robots}".`,
      why: "A noindex page is deliberately kept out of Google's index and cannot rank.",
      confidence: "high", priority: "high", status: "confirmed", owner: seoOwner,
      recommendation: "If the page should rank, remove the noindex directive.",
      verificationSteps: "Confirm the meta robots / X-Robots-Tag no longer contains noindex.",
      isHypothesis: false,
    });
  }
  if (!crawl.title) {
    f.push({
      detected: "Missing page title",
      evidence: "No <title> element found.",
      why: "The title is a primary ranking and click signal.",
      confidence: "high", priority: "high", status: "confirmed", owner: seoOwner,
      recommendation: "Add a concise, descriptive <title> (50–60 characters).",
      verificationSteps: "View source and confirm a <title> is present.",
      isHypothesis: false,
    });
  } else if ((crawl.titleLength ?? 0) > 65) {
    f.push({
      detected: "Title may be too long",
      evidence: `Title is ${crawl.titleLength} characters.`,
      why: "Long titles get truncated in search results.",
      confidence: "medium", priority: "low", status: "open", owner: seoOwner,
      recommendation: "Shorten the title to roughly 50–60 characters.",
      verificationSteps: "Preview the title length in a SERP snippet tool.",
      isHypothesis: false,
    });
  }
  if (!crawl.metaDescription) {
    f.push({
      detected: "Missing meta description",
      evidence: "No <meta name=\"description\"> found.",
      why: "Google auto-generates snippets when none is set, often lowering CTR.",
      confidence: "high", priority: "medium", status: "confirmed", owner: seoOwner,
      recommendation: "Add a unique 150–160 character description matching search intent.",
      verificationSteps: "View source and confirm the meta description is present.",
      isHypothesis: false,
    });
  }
  if (crawl.headingStructure && crawl.headingStructure.filter((h) => h.level === 1).length === 0) {
    f.push({
      detected: "No H1 heading",
      evidence: "No <h1> element detected.",
      why: "The H1 helps users and search engines understand the page topic.",
      confidence: "high", priority: "medium", status: "confirmed", owner: seoOwner,
      recommendation: "Add a single, descriptive H1.",
      verificationSteps: "Confirm exactly one H1 is present.",
      isHypothesis: false,
    });
  } else if (crawl.headingStructure && crawl.headingStructure.filter((h) => h.level === 1).length > 1) {
    f.push({
      detected: "Multiple H1 headings",
      evidence: `${crawl.headingStructure.filter((h) => h.level === 1).length} H1 elements found.`,
      why: "Multiple H1s can dilute the main topic signal.",
      confidence: "medium", priority: "low", status: "open", owner: seoOwner,
      recommendation: "Consolidate to a single H1.",
      verificationSteps: "Confirm only one H1 remains.",
      isHypothesis: false,
    });
  }
  if ((crawl.imagesMissingAlt ?? 0) > 0) {
    f.push({
      detected: `${crawl.imagesMissingAlt} image(s) missing alt text`,
      evidence: `${crawl.imagesMissingAlt} of ${crawl.imagesTotal} images lack an alt attribute.`,
      why: "Alt text aids accessibility and image-search discoverability.",
      confidence: "high", priority: "low", status: "open", owner: devOwner,
      recommendation: "Add descriptive alt text to the affected images.",
      verificationSteps: "Re-audit; images missing alt should be 0.",
      isHypothesis: false,
    });
  }
  if (crawl.canonical && crawl.finalUrl) {
    try {
      const c = new URL(crawl.canonical, crawl.finalUrl);
      const fin = new URL(crawl.finalUrl);
      if (c.href.replace(/\/$/, "") !== fin.href.replace(/\/$/, "")) {
        f.push({
          detected: "Canonical points to a different URL",
          evidence: `Canonical: ${c.href} vs actual: ${fin.href}.`,
          why: "If unintended, Google may index a different URL than expected.",
          confidence: "medium", priority: "medium", status: "investigating", owner: seoOwner,
          recommendation: "Confirm the canonical target is the intended preferred URL.",
          verificationSteps: "Verify the canonical matches the URL you want indexed.",
          isHypothesis: false,
        });
      }
    } catch { /* ignore */ }
  }
  if (crawl.structuredData && crawl.structuredData.length === 0) {
    f.push({
      detected: "No structured data detected",
      evidence: "No JSON-LD schema.org markup found.",
      why: "Structured data can enable rich results and improve understanding.",
      confidence: "medium", priority: "low", status: "open", owner: devOwner,
      recommendation: "Add relevant schema.org markup (e.g. Article, Course, Breadcrumb).",
      verificationSteps: "Validate with the Rich Results Test.",
      isHypothesis: false,
    });
  }
  if ((crawl.wordCount ?? 0) > 0 && (crawl.wordCount ?? 0) < 300) {
    f.push({
      detected: "Thin content",
      evidence: `Approximately ${crawl.wordCount} words of body text.`,
      why: "Very short pages may struggle to satisfy search intent — needs judgement.",
      confidence: "low", priority: "low", status: "hypothesis", owner: seoOwner,
      recommendation: "Review whether the content fully answers the target query.",
      verificationSteps: "Compare depth against top-ranking pages for the target query.",
      isHypothesis: true,
    });
  }

  // --- PageSpeed / Core Web Vitals (confirmed lab measurements) ------------
  if (psi?.fetched) {
    if (psi.lcp != null && psi.lcp > 2.5) {
      f.push({
        detected: `Slow Largest Contentful Paint (${psi.lcp.toFixed(1)}s)`,
        evidence: `Lab LCP is ${psi.lcp.toFixed(1)}s; 'good' is ≤ 2.5s.`,
        why: "Slow loading hurts user experience and can affect rankings.",
        confidence: "high", priority: "high", status: "confirmed", owner: devOwner,
        recommendation: "Optimise/preload the largest element (often the hero image); defer non-critical JS.",
        verificationSteps: "Re-test in PageSpeed Insights; target LCP ≤ 2.5s.",
        isHypothesis: false,
      });
    }
    if (psi.cls != null && psi.cls > 0.1) {
      f.push({
        detected: `Layout shift too high (CLS ${psi.cls.toFixed(2)})`,
        evidence: `CLS is ${psi.cls.toFixed(2)}; 'good' is ≤ 0.1.`,
        why: "Unexpected layout movement frustrates users.",
        confidence: "high", priority: "medium", status: "confirmed", owner: devOwner,
        recommendation: "Set explicit width/height on media and reserve space for dynamic content.",
        verificationSteps: "Re-test; target CLS ≤ 0.1.",
        isHypothesis: false,
      });
    }
    if (psi.inp != null && psi.inp > 200) {
      f.push({
        detected: `Slow interactivity (INP ${Math.round(psi.inp)}ms)`,
        evidence: `INP is ${Math.round(psi.inp)}ms; 'good' is ≤ 200ms.`,
        why: "Sluggish responses to input hurt perceived performance.",
        confidence: "high", priority: "medium", status: "confirmed", owner: devOwner,
        recommendation: "Reduce main-thread work and break up long tasks.",
        verificationSteps: "Re-test; target INP ≤ 200ms.",
        isHypothesis: false,
      });
    }
    if (psi.performanceScore != null && psi.performanceScore < 50) {
      f.push({
        detected: `Low PageSpeed performance score (${psi.performanceScore}/100)`,
        evidence: `Lighthouse mobile performance score is ${psi.performanceScore}.`,
        why: "A low score usually reflects several performance issues.",
        confidence: "high", priority: "high", status: "confirmed", owner: devOwner,
        recommendation: "Work through the specific PageSpeed opportunities listed by Lighthouse.",
        verificationSteps: "Re-run PageSpeed Insights and confirm the score improves.",
        isHypothesis: false,
      });
    }
  }

  // --- Traffic-pattern hypotheses (NOT proof) ------------------------------
  if (seo?.hasData) {
    if (seo.impressions > 500 && seo.ctr < 0.015) {
      f.push({
        detected: "High impressions but low click-through rate",
        evidence: `${seo.impressions.toLocaleString()} impressions at ${(seo.ctr * 100).toFixed(2)}% CTR.`,
        why: "The page is seen in search but rarely clicked — the title/description may not match intent. This is a hypothesis to investigate, not a confirmed defect.",
        confidence: "medium", priority: "medium", status: "hypothesis", owner: seoOwner,
        recommendation: "Review the title and meta description against the top queries and competing results.",
        verificationSteps: "Compare CTR to similar pages and test a revised title/description.",
        isHypothesis: true,
      });
    }
    if (seoDelta?.clicks.value != null && seoDelta.clicks.direction === "down" && seoDelta.clicks.value < -20) {
      f.push({
        detected: "Search clicks declined vs previous period",
        evidence: `Clicks changed by ${seoDelta.clicks.value.toFixed(1)}% vs the equivalent previous period.`,
        why: "A decline can have many causes (seasonality, ranking loss, indexing, content changes). Needs investigation before concluding.",
        confidence: "low", priority: "medium", status: "hypothesis", owner: seoOwner,
        recommendation: "Compare query-level data, check rankings and recent technical changes.",
        verificationSteps: "Confirm which queries/pages drove the change in Search Console.",
        isHypothesis: true,
      });
    }
    if (seo.impressions > 0 && seo.impressions < 50) {
      f.push({
        detected: "Very low impressions",
        evidence: `Only ${seo.impressions} impressions in the period.`,
        why: "Could indicate low search demand, weak indexing, or limited keyword coverage — low traffic alone is not proof of an SEO defect.",
        confidence: "low", priority: "low", status: "hypothesis", owner: seoOwner,
        recommendation: "Check indexing status, target-keyword demand and internal linking before acting.",
        verificationSteps: "Use URL Inspection to confirm indexing and review keyword demand.",
        isHypothesis: true,
      });
    }
  }
  if (analytics?.hasData && analytics.activeUsers > 30 && analytics.engagementRate < 0.4) {
    f.push({
      detected: "Low engagement rate",
      evidence: `Engagement rate is ${(analytics.engagementRate * 100).toFixed(0)}%.`,
      why: "May reflect content relevance, usability or traffic-source mismatch — investigate rather than assume.",
      confidence: "low", priority: "low", status: "hypothesis", owner: seoOwner,
      recommendation: "Examine content relevance, page usability and which channels send this traffic.",
      verificationSteps: "Segment engagement by traffic source and compare to site average.",
      isHypothesis: true,
    });
  }

  return f;
}
