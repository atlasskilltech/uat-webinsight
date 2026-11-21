import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { getInvoiceContext } from "@/lib/invoice/org";
import { aiConfigured } from "@/lib/invoice/agent/llm";
import {
  listConversations,
  getMessages,
  listAgentApprovals,
  listActivity,
} from "@/lib/invoice/services/agent";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NotReady } from "../not-ready";
import { AssistantWorkspace, type ChatMessage, type ConversationItem, type ApprovalItem, type ActivityItem } from "./assistant-client";

export const metadata: Metadata = { title: "AI Invoice Assistant" };
export const dynamic = "force-dynamic";

function messageSteps(toolCalls: unknown): { tool: string; summary: string; ok: boolean }[] {
  if (toolCalls && typeof toolCalls === "object" && "steps" in toolCalls) {
    const s = (toolCalls as { steps?: unknown }).steps;
    if (Array.isArray(s)) return s as { tool: string; summary: string; ok: boolean }[];
  }
  return [];
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="AI Invoice Assistant" canSetup={ctx?.canSetup} />;

  if (!aiConfigured()) {
    return (
      <div>
        <PageHeader title="AI Invoice Assistant" description="Ask questions and run invoice operations in natural language." />
        <EmptyState
          icon={Bot}
          title="AI assistant is not configured"
          description="Set AI_PROVIDER (anthropic), AI_MODEL and AI_API_KEY in your environment to enable the agent. All data access is through safe, permission-checked tools — never raw SQL."
        />
      </div>
    );
  }

  const sp = await searchParams;
  const [conversations, approvals, activity] = await Promise.all([
    listConversations(ctx.organizationId, ctx.user.id),
    listAgentApprovals(ctx.organizationId),
    listActivity(ctx.organizationId, 30),
  ]);

  const activeId = sp.c && conversations.some((c) => c.id === sp.c) ? sp.c : conversations[0]?.id ?? null;
  const rawMessages = activeId ? await getMessages(activeId) : [];
  const messages: ChatMessage[] = rawMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content ?? "", steps: messageSteps(m.tool_calls) }));

  const conversationItems: ConversationItem[] = conversations.map((c) => ({ id: c.id, title: c.title ?? "Untitled", }));
  const approvalItems: ApprovalItem[] = approvals.map((a) => ({ id: a.id, action: a.action, summary: a.summary ?? "" }));
  const activityItems: ActivityItem[] = activity.map((a) => ({ id: a.id, event: a.event, summary: a.summary }));

  return (
    <div>
      <PageHeader
        title="AI Invoice Assistant"
        description="Natural-language finance operations. The agent only uses safe, permission-checked tools; sensitive actions require your approval."
      />
      <AssistantWorkspace
        activeConversationId={activeId}
        conversations={conversationItems}
        initialMessages={messages}
        approvals={approvalItems}
        activity={activityItems}
      />
    </div>
  );
}
