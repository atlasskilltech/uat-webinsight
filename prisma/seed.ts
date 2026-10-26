/**
 * Demo seed — populates the dashboard with clearly-labelled sample data so the
 * UI can be explored before real integrations are connected. EVERY business
 * record created here carries isDemo = true (and SEO/GA4 snapshots belong to an
 * ImportBatch marked isDemo) so demo figures are never confused with Atlas's
 * real metrics. Run with `npm run db:seed`. Re-running replaces demo data only.
 */
import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { resolveDatabaseUrl } from "../src/lib/db-url";

// Load .env so DATABASE_URL / DB_* are available when run directly via tsx.
loadEnvConfig(process.cwd());

const prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });

// Deterministic pseudo-random so seeded trends look the same each run.
function makeRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const rng = makeRng(42);

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

const SITE = "https://atlasuniversity.edu.in";

async function clearDemo() {
  // Derived/analytical data is fully regenerated.
  await prisma.auditFinding.deleteMany({});
  await prisma.pageAudit.deleteMany({});
  await prisma.seoSnapshot.deleteMany({});
  await prisma.analyticsSnapshot.deleteMany({});
  await prisma.importBatch.deleteMany({ where: { isDemo: true } });
  // Business records flagged as demo.
  await prisma.taskActivity.deleteMany({});
  await prisma.workLog.deleteMany({ where: { isDemo: true } });
  await prisma.task.deleteMany({ where: { isDemo: true } });
  await prisma.technicalIssue.deleteMany({ where: { isDemo: true } });
  await prisma.operationsLog.deleteMany({ where: { isDemo: true } });
  await prisma.serverAsset.deleteMany({ where: { isDemo: true } });
  await prisma.competitorResearch.deleteMany({ where: { isDemo: true } });
  await prisma.report.deleteMany({ where: { isDemo: true } });
  await prisma.websitePage.deleteMany({});
  await prisma.project.deleteMany({});
}

async function main() {
  console.log("Seeding demo data…");
  await clearDemo();

  // --- Settings + integrations (NOT connected by default) -------------------
  await prisma.appSettings.upsert({
    where: { id: "app" },
    update: {},
    create: {
      id: "app",
      siteName: "Atlas University",
      siteUrl: `${SITE}/`,
      ownerName: "Atlas Web & SEO Team",
      ownerEmail: "tech@atlasuniversity.edu.in",
    },
  });
  for (const provider of ["gsc", "ga4", "psi"]) {
    await prisma.integration.upsert({
      where: { provider },
      update: {},
      create: { provider, status: "not_connected" },
    });
  }

  // --- Projects -------------------------------------------------------------
  const projects = await Promise.all(
    [
      { name: "Website SEO", color: "#4f46e5", description: "Organic search growth across atlasuniversity.edu.in" },
      { name: "Admissions Microsites", color: "#0ea5e9", description: "School and programme landing pages" },
      { name: "Infrastructure & Hosting", color: "#d97706", description: "cPanel, DNS, SSL and backend reliability" },
      { name: "Reporting", color: "#16a34a", description: "Weekly and monthly management reporting" },
    ].map((p) => prisma.project.create({ data: p })),
  );
  const projById = Object.fromEntries(projects.map((p) => [p.name, p.id]));

  // --- Website pages --------------------------------------------------------
  const pageData = [
    { url: `${SITE}/`, path: "/", title: "Atlas University — Home", section: "home" },
    { url: `${SITE}/admissions`, path: "/admissions", title: "Admissions", section: "admissions" },
    { url: `${SITE}/schools/isdi`, path: "/schools/isdi", title: "ISDI — School of Design & Innovation", section: "school" },
    {
      url: `${SITE}/schools/isdi/blog/bachelor-of-interior-design-materials-guide-bdes`,
      path: "/schools/isdi/blog/bachelor-of-interior-design-materials-guide-bdes",
      title: "Bachelor of Interior Design: Materials Guide (BDes)",
      section: "blog",
    },
    { url: `${SITE}/schools/isme`, path: "/schools/isme", title: "ISME — School of Management", section: "school" },
    { url: `${SITE}/programmes/btech`, path: "/programmes/btech", title: "B.Tech Programmes", section: "programme" },
  ];
  const pages = await Promise.all(
    pageData.map((p) => prisma.websitePage.create({ data: p })),
  );
  const pageByPath = Object.fromEntries(pages.map((p) => [p.path, p]));

  // --- SEO + Analytics snapshots (90 days) ----------------------------------
  const gscBatch = await prisma.importBatch.create({
    data: {
      source: "gsc",
      fileName: "demo-seed",
      isDemo: true,
      rowCount: 0,
      periodStart: daysAgo(89),
      periodEnd: daysAgo(0),
      message: "Seeded demonstration data",
    },
  });
  const ga4Batch = await prisma.importBatch.create({
    data: {
      source: "ga4",
      fileName: "demo-seed",
      isDemo: true,
      rowCount: 0,
      periodStart: daysAgo(89),
      periodEnd: daysAgo(0),
      message: "Seeded demonstration data",
    },
  });

  // Weight share of total per page (homepage largest).
  const pageWeights: Record<string, number> = {
    "/": 0.34,
    "/admissions": 0.2,
    "/schools/isdi": 0.12,
    "/schools/isdi/blog/bachelor-of-interior-design-materials-guide-bdes": 0.08,
    "/schools/isme": 0.14,
    "/programmes/btech": 0.12,
  };

  const seoRows: any[] = [];
  const gaRows: any[] = [];
  for (let d = 89; d >= 0; d--) {
    const date = daysAgo(d);
    const dow = date.getDay();
    const weekend = dow === 0 || dow === 6 ? 0.72 : 1;
    const growth = 1 + (89 - d) * 0.0022; // gentle upward trend
    const noise = 0.85 + rng() * 0.3;
    const baseImpr = 4200 * weekend * growth * noise;
    const baseClicks = baseImpr * (0.038 + rng() * 0.01);
    const baseViews = 2600 * weekend * growth * noise;
    const baseUsers = baseViews * (0.6 + rng() * 0.08);

    // Aggregate (pageId null)
    seoRows.push({
      propertyId: "demo", source: "gsc", startDate: date, endDate: date,
      clicks: Math.round(baseClicks), impressions: Math.round(baseImpr),
      ctr: baseClicks / baseImpr, position: 12 - (89 - d) * 0.02 + rng() * 1.5,
      isDemo: true, importBatchId: gscBatch.id, importedAt: new Date(),
    });
    gaRows.push({
      propertyId: "demo", source: "ga4", startDate: date, endDate: date,
      views: Math.round(baseViews), activeUsers: Math.round(baseUsers),
      sessions: Math.round(baseUsers * 1.3), engagedSessions: Math.round(baseUsers * 1.3 * 0.62),
      engagementRate: 0.6 + rng() * 0.08, avgEngagementSecs: 70 + rng() * 40,
      isDemo: true, importBatchId: ga4Batch.id, importedAt: new Date(),
    });

    // Per-page for the first 45 days (keeps row count modest)
    if (d <= 45) {
      for (const [path, weight] of Object.entries(pageWeights)) {
        const page = pageByPath[path];
        const pImpr = baseImpr * weight * (0.9 + rng() * 0.2);
        const pClicks = pImpr * (0.03 + rng() * 0.02);
        const pViews = baseViews * weight * (0.9 + rng() * 0.2);
        const pUsers = pViews * (0.6 + rng() * 0.08);
        seoRows.push({
          propertyId: "demo", source: "gsc", startDate: date, endDate: date, pageId: page.id,
          clicks: Math.round(pClicks), impressions: Math.round(pImpr),
          ctr: pClicks / pImpr, position: 8 + weight * 20 + rng() * 3,
          isDemo: true, importBatchId: gscBatch.id,
        });
        gaRows.push({
          propertyId: "demo", source: "ga4", startDate: date, endDate: date, pageId: page.id,
          views: Math.round(pViews), activeUsers: Math.round(pUsers),
          sessions: Math.round(pUsers * 1.25), engagedSessions: Math.round(pUsers * 1.25 * 0.6),
          engagementRate: 0.55 + rng() * 0.1, avgEngagementSecs: 60 + rng() * 50,
          isDemo: true, importBatchId: ga4Batch.id,
        });
      }
    }
  }
  await prisma.seoSnapshot.createMany({ data: seoRows });
  await prisma.analyticsSnapshot.createMany({ data: gaRows });
  await prisma.importBatch.update({ where: { id: gscBatch.id }, data: { rowCount: seoRows.length } });
  await prisma.importBatch.update({ where: { id: ga4Batch.id }, data: { rowCount: gaRows.length } });

  // --- Tasks ----------------------------------------------------------------
  const tasks = [
    {
      title: "Fix missing meta descriptions on ISDI blog posts",
      description: "Several ISDI blog articles have no meta description, hurting CTR.",
      category: "seo", status: "in_progress", priority: "high", progress: 60,
      projectId: projById["Website SEO"], startDate: daysAgo(4), dueDate: daysAgo(-2),
      relatedUrl: `${SITE}/schools/isdi/blog/bachelor-of-interior-design-materials-guide-bdes`,
      nextAction: "Draft descriptions for remaining 6 posts and hand to content team.",
    },
    {
      title: "Submit updated XML sitemap to Search Console",
      category: "seo", status: "completed", priority: "medium", progress: 100,
      projectId: projById["Website SEO"], startDate: daysAgo(6), completedDate: daysAgo(2),
      completionSummary: "Regenerated sitemap, submitted and confirmed 1,240 URLs discovered.",
    },
    {
      title: "Investigate 12% organic traffic dip on admissions pages",
      description: "GA4 shows a week-over-week decline on /admissions. Compare equivalent ranges.",
      category: "seo", status: "in_progress", priority: "critical", progress: 30,
      projectId: projById["Website SEO"], startDate: daysAgo(2), dueDate: daysAgo(-1),
      nextAction: "Pull query-level GSC data and check for ranking losses.",
    },
    {
      title: "Renew SSL certificate for mail subdomain",
      category: "server", status: "blocked", priority: "high", progress: 20,
      projectId: projById["Infrastructure & Hosting"], startDate: daysAgo(3), dueDate: daysAgo(-5),
      blocker: "Waiting on hosting provider to grant WHM access.",
      nextAction: "Follow up with hosting support ticket #48213.",
    },
    {
      title: "Optimise homepage LCP (hero image)",
      category: "website", status: "not_started", priority: "high", progress: 0,
      projectId: projById["Website SEO"], dueDate: daysAgo(-7),
      relatedUrl: `${SITE}/`,
    },
    {
      title: "Weekly management report — week 42",
      category: "reporting", status: "completed", priority: "medium", progress: 100,
      projectId: projById["Reporting"], startDate: daysAgo(7), completedDate: daysAgo(5),
      completionSummary: "Delivered to management with SEO and infra summary.",
    },
    {
      title: "Audit B.Tech programme pages for indexability",
      category: "seo", status: "not_started", priority: "medium", progress: 0,
      projectId: projById["Admissions Microsites"], dueDate: daysAgo(-3),
      relatedUrl: `${SITE}/programmes/btech`,
    },
    {
      title: "Set up weekly database backup verification",
      category: "backend", status: "in_progress", priority: "medium", progress: 45,
      projectId: projById["Infrastructure & Hosting"], startDate: daysAgo(5),
      nextAction: "Script a restore-test into staging.",
    },
    {
      title: "Research competitor scholarship landing pages",
      category: "research", status: "completed", priority: "low", progress: 100,
      projectId: projById["Admissions Microsites"], completedDate: daysAgo(1),
      completionSummary: "Logged 3 observations in Competitor Intelligence.",
    },
    {
      title: "Add structured data (Course schema) to programme pages",
      category: "seo", status: "not_started", priority: "high", progress: 0,
      projectId: projById["Website SEO"], dueDate: daysAgo(-10),
    },
    {
      title: "Reduce TTFB on cPanel server (enable caching)",
      category: "server", status: "in_progress", priority: "high", progress: 50,
      projectId: projById["Infrastructure & Hosting"], startDate: daysAgo(8),
    },
    {
      title: "Fix broken internal links found in crawl",
      category: "website", status: "completed", priority: "medium", progress: 100,
      projectId: projById["Website SEO"], completedDate: daysAgo(3),
      completionSummary: "Resolved 14 of 14 broken links.",
    },
  ];
  for (const t of tasks) {
    const created = await prisma.task.create({ data: { ...t, isDemo: true } });
    await prisma.taskActivity.create({
      data: { taskId: created.id, type: "created", message: "Task created" },
    });
    if (t.status === "completed") {
      await prisma.taskActivity.create({
        data: { taskId: created.id, type: "completed", message: "Marked as completed" },
      });
    }
  }

  // --- Work logs ------------------------------------------------------------
  const logs = [
    { date: daysAgo(0), summary: "Reviewed GSC coverage report; flagged 3 pages excluded by 'crawled – not indexed'.", category: "seo", minutes: 90 },
    { date: daysAgo(1), summary: "Drafted meta descriptions for ISDI blog posts.", category: "seo", minutes: 120 },
    { date: daysAgo(1), summary: "Opened hosting ticket for WHM access to renew SSL.", category: "server", minutes: 25 },
    { date: daysAgo(2), summary: "Compared admissions traffic vs previous 7 days in GA4.", category: "seo", minutes: 60 },
    { date: daysAgo(3), summary: "Deployed internal-link fixes to production.", category: "website", minutes: 75 },
    { date: daysAgo(5), summary: "Wrote and sent week-42 management report.", category: "reporting", minutes: 110 },
  ];
  await prisma.workLog.createMany({ data: logs.map((l) => ({ ...l, isDemo: true })) });

  // --- Technical issues -----------------------------------------------------
  const issues = [
    {
      title: "Homepage LCP above 4s on mobile",
      urls: [`${SITE}/`], category: "performance", severity: "high", priority: "high",
      status: "open", approvalStatus: "approved",
      evidence: "PageSpeed Insights mobile LCP 4.3s; hero image 820KB, not lazy-loaded.",
      impact: "Poor Core Web Vitals can suppress rankings and hurt conversion.",
      recommendedFix: "Serve a compressed WebP hero, add width/height, preload LCP image.",
      source: "PageSpeed Insights",
    },
    {
      title: "Missing meta descriptions on 6 ISDI blog posts",
      urls: [`${SITE}/schools/isdi/blog/bachelor-of-interior-design-materials-guide-bdes`],
      category: "metadata", severity: "medium", priority: "high", status: "in_progress",
      approvalStatus: "approved",
      evidence: "Crawl shows empty <meta name='description'> on 6 URLs.",
      impact: "Google generates snippets automatically, often lowering CTR.",
      recommendedFix: "Add unique 150–160 char descriptions per post.",
      source: "Site crawl",
    },
    {
      title: "Programme pages missing Course structured data",
      urls: [`${SITE}/programmes/btech`], category: "structured_data", severity: "medium",
      priority: "medium", status: "open", approvalStatus: "pending",
      evidence: "No schema.org/Course markup detected on programme templates.",
      impact: "Missing eligibility for course rich results.",
      recommendedFix: "Add Course + Organization JSON-LD to the programme template.",
    },
    {
      title: "Admissions pages: 'Crawled – currently not indexed'",
      urls: [`${SITE}/admissions`], category: "indexing", severity: "high", priority: "critical",
      status: "open", approvalStatus: "pending",
      evidence: "GSC Coverage reports 3 admissions URLs excluded.",
      impact: "Pages cannot rank or receive organic clicks while unindexed.",
      recommendedFix: "Improve internal linking, content depth; request indexing after review.",
      source: "Search Console",
    },
    {
      title: "Mixed-content warning on one legacy page",
      urls: [`${SITE}/schools/isme`], category: "other", severity: "low", priority: "low",
      status: "fixed", approvalStatus: "not_required",
      evidence: "An http:// image reference on a legacy template.",
      impact: "Browser console warning; minor trust signal.",
      recommendedFix: "Update asset URL to https://.",
      verificationResult: "Fixed, pending re-crawl verification.",
    },
    {
      title: "14 broken internal links in site crawl",
      urls: [`${SITE}/schools/isdi`], category: "links", severity: "medium", priority: "medium",
      status: "verified", approvalStatus: "approved",
      evidence: "Crawl returned 14 internal 404s.",
      impact: "Wastes crawl budget and harms UX.",
      recommendedFix: "Redirect or correct the 14 target URLs.",
      verificationResult: "Re-crawl confirmed 0 broken links.",
      dateResolved: daysAgo(3),
    },
  ];
  for (const i of issues) {
    await prisma.technicalIssue.create({
      data: {
        ...i, urls: i.urls, isDemo: true,
        dateDiscovered: daysAgo(Math.floor(rng() * 20) + 3),
      },
    });
  }

  // --- Page audit + findings (the example blog URL) -------------------------
  const blog = pageByPath["/schools/isdi/blog/bachelor-of-interior-design-materials-guide-bdes"];
  const audit = await prisma.pageAudit.create({
    data: {
      url: blog.url, pageId: blog.id, httpStatus: 200, indexable: "indexable",
      robots: "index, follow", canonical: blog.url,
      title: "Bachelor of Interior Design: Materials Guide (BDes) | ISDI | Atlas University",
      titleLength: 78,
      metaDescription: null, metaDescLength: 0,
      h1: "Bachelor of Interior Design: A Complete Materials Guide",
      headingStructure: [
        { level: 1, text: "Bachelor of Interior Design: A Complete Materials Guide" },
        { level: 2, text: "Why materials matter in interior design" },
        { level: 2, text: "Core material categories" },
        { level: 3, text: "Natural materials" },
        { level: 3, text: "Engineered materials" },
      ],
      imagesTotal: 12, imagesMissingAlt: 5, internalLinks: 18, externalLinks: 3,
      brokenLinks: [], redirects: [], structuredData: ["BreadcrumbList"],
      wordCount: 1430, performanceScore: 64, accessibilityScore: 88, seoScore: 82, mobileScore: 61,
      lcp: 3.9, cls: 0.04, inp: 180, psiFetched: false, fetchedHtml: false,
      notes: "Seeded example audit for demonstration.",
    },
  });
  await prisma.auditFinding.createMany({
    data: [
      {
        auditId: audit.id, detected: "Missing meta description",
        evidence: "No <meta name='description'> present.", why: "Google auto-generates snippets, usually lowering CTR.",
        confidence: "high", recommendation: "Add a unique 150–160 character description.",
        priority: "high", status: "confirmed", isHypothesis: false,
        verificationSteps: "View source and confirm the meta description tag is present.",
      },
      {
        auditId: audit.id, detected: "5 of 12 images missing alt text",
        evidence: "5 <img> elements have empty or missing alt attributes.",
        why: "Hurts accessibility and image-search discoverability.", confidence: "high",
        recommendation: "Add descriptive alt text to the 5 images.", priority: "medium",
        status: "open", isHypothesis: false,
        verificationSteps: "Re-run the page audit; images missing alt should be 0.",
      },
      {
        auditId: audit.id, detected: "Mobile LCP 3.9s (needs improvement)",
        evidence: "Lab LCP 3.9s on mobile; threshold for 'good' is 2.5s.",
        why: "Slow largest paint can reduce rankings and engagement.", confidence: "medium",
        recommendation: "Compress and preload the hero image; defer non-critical JS.",
        priority: "high", status: "open", isHypothesis: false,
        verificationSteps: "Re-test in PageSpeed Insights; target LCP ≤ 2.5s.",
      },
      {
        auditId: audit.id, detected: "Possible low click-through vs impressions",
        evidence: "Demo data shows impressions rising while clicks are flat.",
        why: "May indicate the title/description doesn't match search intent — needs confirmation.",
        confidence: "low", recommendation: "Review the query-level data before concluding; this is a hypothesis, not a confirmed defect.",
        priority: "low", status: "hypothesis", isHypothesis: true,
        verificationSteps: "Compare CTR against similar pages and check top queries in GSC.",
      },
    ],
  });

  // --- Server assets --------------------------------------------------------
  await prisma.serverAsset.createMany({
    data: [
      { type: "hosting", name: "cPanel shared hosting", provider: "Hostinger", plan: "Business", environment: "production", status: "active", notes: "Primary web hosting for atlasuniversity.edu.in", isDemo: true, details: { diskUsage: "42% of 200GB", phpVersion: "8.2" } },
      { type: "domain", name: "atlasuniversity.edu.in", provider: "INRegistry", environment: "production", status: "active", isDemo: true, details: { registered: "2019", autoRenew: true } },
      { type: "ssl", name: "SSL — atlasuniversity.edu.in", provider: "Let's Encrypt", status: "active", sslExpiry: daysAgo(-48), isDemo: true, details: { issuer: "R3", autoRenew: true } },
      { type: "database", name: "MySQL (primary)", provider: "cPanel MySQL", version: "8.0", environment: "production", status: "active", isDemo: true, details: { sizeMB: 310 } },
      { type: "application", name: "WordPress (main site)", version: "6.6", environment: "production", status: "active", isDemo: true, details: { plugins: 24, theme: "Custom Atlas" } },
      { type: "api", name: "Google Analytics Data API", provider: "Google", status: "active", environment: "production", isDemo: true, details: { usage: "within quota" } },
    ],
  });

  // --- Operations log -------------------------------------------------------
  await prisma.operationsLog.createMany({
    data: [
      { system: "cPanel / Apache", title: "Investigated intermittent 503 errors", kind: "incident", occurredAt: daysAgo(6), symptoms: "Sporadic 503s during peak hours.", investigation: "Checked error logs; PHP-FPM max children reached.", resolution: "Raised pm.max_children; monitoring.", verificationStatus: "verified", status: "resolved", httpStatus: 503, responsiblePerson: "Web team", isDemo: true },
      { system: "DNS", title: "Added SPF/DKIM records for email deliverability", kind: "maintenance", occurredAt: daysAgo(9), resolution: "Records added and validated.", verificationStatus: "verified", status: "resolved", responsiblePerson: "Web team", isDemo: true },
      { system: "Database", title: "Weekly backup verification", kind: "backup", occurredAt: daysAgo(1), resolution: "Backup present; restore test pending automation.", verificationStatus: "pending", status: "monitoring", responsiblePerson: "Web team", isDemo: true },
      { system: "SSL", title: "mail subdomain certificate renewal", kind: "task", occurredAt: daysAgo(3), symptoms: "Cert expires soon.", investigation: "Needs WHM access.", status: "open", verificationStatus: "pending", approvedBy: "Pending", responsiblePerson: "Web team", isDemo: true },
      { system: "WordPress", title: "Core + plugin updates", kind: "deployment", occurredAt: daysAgo(12), resolution: "Updated core to 6.6 and 8 plugins; smoke-tested.", verificationStatus: "verified", status: "resolved", responsiblePerson: "Web team", isDemo: true },
    ],
  });

  // --- Competitor research --------------------------------------------------
  await prisma.competitorResearch.createMany({
    data: [
      { organisation: "Ashoka University", website: "https://www.ashoka.edu.in", observation: "Programme pages include a persistent 'Apply / Enquire' sidebar CTA that follows on scroll.", category: "conversion", evidence: "Observed on live programme pages (public).", relevance: "Could lift enquiry conversion on Atlas programme pages.", effort: "medium", expectedBenefit: "Higher enquiry rate", measurement: "Enquiry form submissions per session (GA4)", recommendation: "pilot", status: "reviewing", isDemo: true },
      { organisation: "FLAME University", website: "https://www.flame.edu.in", observation: "Detailed, well-structured FAQ sections on admissions pages with FAQ schema.", category: "seo", evidence: "Public page source shows FAQPage JSON-LD.", relevance: "FAQ schema can win rich results for admissions queries.", effort: "low", expectedBenefit: "More SERP real estate", measurement: "Impressions/CTR on admissions queries (GSC)", recommendation: "adopt", status: "new", isDemo: true },
      { organisation: "Shiv Nadar University", website: "https://snu.edu.in", observation: "Fast-loading programme pages (observed near-instant navigation).", category: "technology", evidence: "Subjective public observation — not a measured benchmark.", isAssumption: true, relevance: "Performance is a ranking & UX factor.", effort: "high", expectedBenefit: "Better CWV", measurement: "Core Web Vitals field data", recommendation: "investigate", status: "new", isDemo: true },
      { organisation: "Krea University", website: "https://krea.edu.in", observation: "Strong editorial blog with clear author bios and topic clustering.", category: "content", evidence: "Public blog structure.", relevance: "Topic clusters can build topical authority for Atlas blogs.", effort: "high", expectedBenefit: "Organic growth on informational queries", measurement: "Organic clicks to blog section (GSC)", recommendation: "investigate", status: "new", isDemo: true },
      { organisation: "Plaksha University", website: "https://plaksha.edu.in", observation: "Uses a single prominent 'Download Brochure' lead magnet across programme pages.", category: "admissions", evidence: "Public programme pages.", relevance: "Lead-magnet capture for nurturing prospects.", effort: "medium", expectedBenefit: "Lead capture volume", measurement: "Brochure downloads (events in GA4)", recommendation: "pilot", status: "reviewing", isDemo: true },
    ],
  });

  // --- Sample report --------------------------------------------------------
  await prisma.report.create({
    data: {
      title: "Weekly report — demo week",
      type: "weekly",
      periodStart: daysAgo(6),
      periodEnd: daysAgo(0),
      comparePeriodStart: daysAgo(13),
      comparePeriodEnd: daysAgo(7),
      status: "draft",
      isDemo: true,
      executiveSummary:
        "DEMO: Organic visibility trended up week-over-week. Key focus: resolve admissions indexing and homepage LCP. See sections below for figures and recommendations.",
    },
  });

  const counts = {
    projects: projects.length,
    pages: pages.length,
    seoSnapshots: seoRows.length,
    analyticsSnapshots: gaRows.length,
    tasks: tasks.length,
    issues: issues.length,
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
