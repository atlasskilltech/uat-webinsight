import type { Metadata } from "next";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getIntegrations } from "@/lib/integrations";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Settings & Integrations" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Settings is admin-only (not just hidden in the sidebar).
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.role !== "admin") {
    return (
      <div>
        <PageHeader title="Settings & Integrations" description="Configure the website property, integrations and data." />
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-foreground">
            <ShieldAlert className="h-5 w-5 text-danger" />
            <span>
              <strong>Access denied.</strong> Settings is available to administrators only.
            </span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [settings, integrations, batches, demoCount, realCount] = await Promise.all([
    getSettings(),
    getIntegrations(),
    prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.seoSnapshot.count({ where: { isDemo: true } }).then(async (s) =>
      s + (await prisma.analyticsSnapshot.count({ where: { isDemo: true } })),
    ),
    prisma.seoSnapshot.count({ where: { isDemo: false } }).then(async (s) =>
      s + (await prisma.analyticsSnapshot.count({ where: { isDemo: false } })),
    ),
  ]);

  return (
    <div>
      <PageHeader
        title="Settings & Integrations"
        description="Configure the website property, connect Google data sources, import CSV exports and manage demo data."
      />
      <Suspense>
        <SettingsClient
          settings={{
            siteUrl: settings.siteUrl,
            siteName: settings.siteName,
            ownerName: settings.ownerName,
            ownerEmail: settings.ownerEmail,
            timezone: settings.timezone,
            gscProperty: settings.gscProperty,
            ga4Property: settings.ga4Property,
          }}
          integrations={integrations}
          batches={batches}
          demoCount={demoCount}
          realCount={realCount}
        />
      </Suspense>
    </div>
  );
}
