-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "startDate" DATETIME,
    "dueDate" DATETIME,
    "completedDate" DATETIME,
    "estimatedMinutes" INTEGER,
    "actualMinutes" INTEGER,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "relatedUrl" TEXT,
    "notes" TEXT,
    "evidenceLinks" JSONB,
    "completionSummary" TEXT,
    "blocker" TEXT,
    "nextAction" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT,
    "issueId" TEXT,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "TechnicalIssue" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskActivity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "minutes" INTEGER,
    "taskId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebsitePage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT,
    "section" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SeoSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'gsc',
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" REAL NOT NULL DEFAULT 0,
    "position" REAL NOT NULL DEFAULT 0,
    "query" TEXT,
    "device" TEXT,
    "country" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageId" TEXT,
    CONSTRAINT "SeoSnapshot_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SeoSnapshot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WebsitePage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "propertyId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ga4',
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "engagedSessions" INTEGER NOT NULL DEFAULT 0,
    "engagementRate" REAL NOT NULL DEFAULT 0,
    "avgEngagementSecs" REAL NOT NULL DEFAULT 0,
    "channel" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageId" TEXT,
    CONSTRAINT "AnalyticsSnapshot_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AnalyticsSnapshot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WebsitePage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PageAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "pageId" TEXT,
    "httpStatus" INTEGER,
    "indexable" TEXT,
    "robots" TEXT,
    "canonical" TEXT,
    "title" TEXT,
    "titleLength" INTEGER,
    "metaDescription" TEXT,
    "metaDescLength" INTEGER,
    "h1" TEXT,
    "headingStructure" JSONB,
    "imagesTotal" INTEGER,
    "imagesMissingAlt" INTEGER,
    "internalLinks" INTEGER,
    "externalLinks" INTEGER,
    "brokenLinks" JSONB,
    "redirects" JSONB,
    "structuredData" JSONB,
    "wordCount" INTEGER,
    "performanceScore" INTEGER,
    "accessibilityScore" INTEGER,
    "seoScore" INTEGER,
    "mobileScore" INTEGER,
    "lcp" REAL,
    "cls" REAL,
    "inp" REAL,
    "fetchedHtml" BOOLEAN NOT NULL DEFAULT false,
    "psiFetched" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "rawJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PageAudit_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "WebsitePage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditId" TEXT NOT NULL,
    "detected" TEXT NOT NULL,
    "evidence" TEXT,
    "why" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "recommendation" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "verificationSteps" TEXT,
    "isHypothesis" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "PageAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TechnicalIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "urls" JSONB,
    "category" TEXT NOT NULL DEFAULT 'other',
    "evidence" TEXT,
    "source" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "impact" TEXT,
    "recommendedFix" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dateDiscovered" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "implementationNotes" TEXT,
    "verificationResult" TEXT,
    "dateResolved" DATETIME,
    "pageId" TEXT,
    "auditId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ServerAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'application',
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "plan" TEXT,
    "environment" TEXT,
    "version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sslExpiry" DATETIME,
    "details" JSONB,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OperationsLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "system" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'task',
    "symptoms" TEXT,
    "investigation" TEXT,
    "resolution" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'open',
    "httpStatus" INTEGER,
    "approvedBy" TEXT,
    "responsiblePerson" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompetitorResearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organisation" TEXT NOT NULL,
    "website" TEXT,
    "researchDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUrl" TEXT,
    "observation" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'seo',
    "evidence" TEXT,
    "isAssumption" BOOLEAN NOT NULL DEFAULT false,
    "relevance" TEXT,
    "effort" TEXT NOT NULL DEFAULT 'medium',
    "expectedBenefit" TEXT,
    "measurement" TEXT,
    "recommendation" TEXT NOT NULL DEFAULT 'investigate',
    "status" TEXT NOT NULL DEFAULT 'new',
    "followUpDate" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'weekly',
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "comparePeriodStart" DATETIME,
    "comparePeriodEnd" DATETIME,
    "executiveSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "snapshot" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_connected',
    "propertyId" TEXT,
    "lastSyncAt" DATETIME,
    "lastError" TEXT,
    "config" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "fileName" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "propertyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "message" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'app',
    "siteUrl" TEXT NOT NULL DEFAULT 'https://atlasuniversity.edu.in/',
    "siteName" TEXT NOT NULL DEFAULT 'Atlas University',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "ownerEmail" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "gscProperty" TEXT NOT NULL DEFAULT '',
    "ga4Property" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_priority_idx" ON "Task"("priority");

-- CreateIndex
CREATE INDEX "Task_category_idx" ON "Task"("category");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- CreateIndex
CREATE INDEX "TaskActivity_taskId_idx" ON "TaskActivity"("taskId");

-- CreateIndex
CREATE INDEX "WorkLog_date_idx" ON "WorkLog"("date");

-- CreateIndex
CREATE UNIQUE INDEX "WebsitePage_url_key" ON "WebsitePage"("url");

-- CreateIndex
CREATE INDEX "WebsitePage_section_idx" ON "WebsitePage"("section");

-- CreateIndex
CREATE INDEX "SeoSnapshot_pageId_idx" ON "SeoSnapshot"("pageId");

-- CreateIndex
CREATE INDEX "SeoSnapshot_startDate_endDate_idx" ON "SeoSnapshot"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "SeoSnapshot_propertyId_idx" ON "SeoSnapshot"("propertyId");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_pageId_idx" ON "AnalyticsSnapshot"("pageId");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_startDate_endDate_idx" ON "AnalyticsSnapshot"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_propertyId_idx" ON "AnalyticsSnapshot"("propertyId");

-- CreateIndex
CREATE INDEX "PageAudit_url_idx" ON "PageAudit"("url");

-- CreateIndex
CREATE INDEX "PageAudit_pageId_idx" ON "PageAudit"("pageId");

-- CreateIndex
CREATE INDEX "AuditFinding_auditId_idx" ON "AuditFinding"("auditId");

-- CreateIndex
CREATE INDEX "TechnicalIssue_status_idx" ON "TechnicalIssue"("status");

-- CreateIndex
CREATE INDEX "TechnicalIssue_severity_idx" ON "TechnicalIssue"("severity");

-- CreateIndex
CREATE INDEX "TechnicalIssue_category_idx" ON "TechnicalIssue"("category");

-- CreateIndex
CREATE INDEX "ServerAsset_type_idx" ON "ServerAsset"("type");

-- CreateIndex
CREATE INDEX "ServerAsset_status_idx" ON "ServerAsset"("status");

-- CreateIndex
CREATE INDEX "OperationsLog_occurredAt_idx" ON "OperationsLog"("occurredAt");

-- CreateIndex
CREATE INDEX "OperationsLog_status_idx" ON "OperationsLog"("status");

-- CreateIndex
CREATE INDEX "CompetitorResearch_category_idx" ON "CompetitorResearch"("category");

-- CreateIndex
CREATE INDEX "CompetitorResearch_recommendation_idx" ON "CompetitorResearch"("recommendation");

-- CreateIndex
CREATE INDEX "Report_periodStart_periodEnd_idx" ON "Report"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_key" ON "Integration"("provider");

-- CreateIndex
CREATE INDEX "ImportBatch_source_idx" ON "ImportBatch"("source");

-- CreateIndex
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");
