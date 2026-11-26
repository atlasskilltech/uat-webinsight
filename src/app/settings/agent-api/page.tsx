import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { baseUrl } from "@/lib/base-url";
import { listKeys, listLog } from "@/lib/agent-api/repo";
import { SCOPES } from "@/lib/agent-api/scopes";
import { AgentApiClient } from "./agent-api-client";

export const metadata: Metadata = { title: "Agent API (IntelligenceOS)" };
export const dynamic = "force-dynamic";

export default async function AgentApiPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.role !== "admin") {
    return (
      <div>
        <PageHeader title="Agent API (IntelligenceOS)" description="Connect this workspace to the ATLAS IntelligenceOS super agent." />
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-foreground">
            <ShieldAlert className="h-5 w-5 text-danger" />
            <span>
              <strong>Access denied.</strong> The Agent API is available to administrators only.
            </span>
          </CardContent>
        </Card>
      </div>
    );
  }

  // The base URL an admin pastes into IntelligenceOS → Connect project.
  const h = await headers();
  const req = new Request("http://internal", {
    headers: {
      "x-forwarded-host": h.get("x-forwarded-host") ?? "",
      "x-forwarded-proto": h.get("x-forwarded-proto") ?? "",
    },
  });
  const agentApiUrl = `${baseUrl(req)}/api/agent-api`;

  const [keys, log] = await Promise.all([listKeys(), listLog({ limit: 25 })]);

  return (
    <div>
      <PageHeader
        title="Agent API (IntelligenceOS)"
        description="Generate a key so the ATLAS IntelligenceOS super agent (and its voice assistant) can securely read this workspace's data."
      />
      <AgentApiClient
        agentApiUrl={agentApiUrl}
        scopes={SCOPES}
        keys={keys.map((k) => ({
          ...k,
          expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
          revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          createdAt: k.createdAt.toISOString(),
          updatedAt: k.updatedAt.toISOString(),
        }))}
        log={log.map((l) => ({
          id: l.id,
          at: l.at.toISOString(),
          keyName: l.keyName,
          userEmail: l.userEmail,
          action: l.action,
          status: l.status,
          agent: l.agent,
        }))}
      />
    </div>
  );
}
