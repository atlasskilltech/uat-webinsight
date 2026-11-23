"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bot, User, Plus, Send, XCircle, Wrench, ShieldQuestion, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useDictation, useSpeech } from "@/lib/invoice/use-voice";
import { sendAgentMessageAction, decideAgentApprovalAction } from "./actions";

export interface ChatStep { tool: string; summary: string; ok: boolean }
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; steps?: ChatStep[] }
export interface ConversationItem { id: string; title: string }
export interface ApprovalItem { id: string; action: string; summary: string }
export interface ActivityItem { id: string; event: string; summary: string }

const SUGGESTIONS = [
  "Show today's invoices",
  "Check all connected accounts",
  "Which invoice emails are pending forwarding?",
  "Find possible duplicate invoices",
  "Prepare a vendor-wise report",
  "Summarize this week's forwarding activity",
];

export function AssistantWorkspace({
  activeConversationId,
  conversations,
  initialMessages,
  approvals,
  activity,
}: {
  activeConversationId: string | null;
  conversations: ConversationItem[];
  initialMessages: ChatMessage[];
  approvals: ApprovalItem[];
  activity: ActivityItem[];
}) {
  const [conversationId, setConversationId] = useState<string | null>(activeConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [liveApprovals, setLiveApprovals] = useState<ApprovalItem[]>(approvals);
  const router = useRouter();
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const tts = useSpeech();
  const mic = useDictation((t) => setInput((p) => (p ? `${p} ${t}` : t)));

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  function send(text: string) {
    const msg = text.trim();
    if (!msg || pending) return;
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: msg }]);
    startTransition(async () => {
      const res = await sendAgentMessageAction({ conversationId, message: msg });
      if (!res.ok && res.error) {
        toast(res.error, "error");
      }
      const replyText = res.assistantText || res.error || "(no response)";
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", content: replyText, steps: res.steps },
      ]);
      tts.speak(replyText);
      if (res.approvals.length) setLiveApprovals((a) => [...res.approvals.map((x) => ({ id: x.id, action: x.action, summary: x.summary })), ...a]);
      if (res.conversationId && res.conversationId !== conversationId) {
        setConversationId(res.conversationId);
        window.history.replaceState(null, "", `/invoices/assistant?c=${res.conversationId}`);
        router.refresh();
      }
    });
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    window.history.replaceState(null, "", "/invoices/assistant");
  }

  function decide(id: string, decision: "approved" | "rejected") {
    startTransition(async () => {
      const res = await decideAgentApprovalAction({ approvalId: id, decision });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        setLiveApprovals((a) => a.filter((x) => x.id !== id));
        router.refresh();
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Conversations */}
      <div className="lg:col-span-3">
        <Button variant="secondary" className="mb-3 w-full" onClick={newChat}><Plus className="h-4 w-4" /> New chat</Button>
        <Card>
          <CardContent className="p-2">
            {conversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted">No conversations yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <a
                      href={`/invoices/assistant?c=${c.id}`}
                      className={cn(
                        "block truncate rounded-md px-2.5 py-2 text-sm hover:bg-surface-hover",
                        c.id === conversationId ? "bg-surface-2 font-medium text-foreground" : "text-muted",
                      )}
                    >
                      {c.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Chat */}
      <div className="lg:col-span-6">
        <Card className="flex h-[70vh] flex-col">
          <CardContent className="flex-1 space-y-4 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="py-8 text-center">
                <Bot className="mx-auto h-8 w-8 text-muted-2" />
                <p className="mt-2 text-sm font-medium">Ask the Invoice Agent</p>
                <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-muted hover:text-foreground">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} m={m} />)
            )}
            {pending && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Bot className="h-4 w-4 animate-pulse" /> Thinking…
              </div>
            )}
            <div ref={endRef} />
          </CardContent>
          <div className="border-t border-border p-3">
            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={mic.listening ? "Listening… speak now" : "Ask about invoices, payments, duplicates…"}
                className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring"
                disabled={pending}
              />
              {mic.supported && (
                <Button
                  type="button"
                  size="icon"
                  variant={mic.listening ? undefined : "secondary"}
                  onClick={mic.toggle}
                  title={mic.listening ? "Stop dictation" : "Speak your message"}
                  aria-label={mic.listening ? "Stop dictation" : "Dictate"}
                >
                  {mic.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              {tts.supported && (
                <Button
                  type="button"
                  size="icon"
                  variant={tts.enabled ? undefined : "secondary"}
                  onClick={() => {
                    const next = !tts.enabled;
                    tts.setEnabled(next);
                    if (!next) tts.stop();
                  }}
                  title={tts.enabled ? "Replies read aloud (on)" : "Read replies aloud"}
                  aria-label={tts.enabled ? "Turn off read aloud" : "Turn on read aloud"}
                >
                  {tts.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </Button>
              )}
              <Button type="submit" size="icon" disabled={pending || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </Card>
      </div>

      {/* Approvals + activity */}
      <div className="space-y-4 lg:col-span-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldQuestion className="h-4 w-4" /> Pending approvals</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {liveApprovals.length === 0 ? (
              <p className="text-xs text-muted">Nothing awaiting approval.</p>
            ) : (
              liveApprovals.map((a) => (
                <div key={a.id} className="rounded-lg border border-border bg-surface-2 p-2.5">
                  <p className="text-xs font-medium">{a.action}</p>
                  <p className="mt-0.5 break-words text-[11px] text-muted">{a.summary}</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => decide(a.id, "approved")}>Approve</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(a.id, "rejected")}>Reject</Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Agent activity</CardTitle></CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-xs text-muted">No activity yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-2">
                    <span className="font-medium text-muted-2">{a.event}</span>
                    <span className="truncate text-muted">{a.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", isUser ? "bg-accent text-accent-foreground" : "bg-surface-2 text-accent")}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>
      <div className={cn("max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm", isUser ? "bg-accent text-accent-foreground" : "bg-surface-2 text-foreground")}>
        <p className="whitespace-pre-wrap">{m.content}</p>
        {m.steps && m.steps.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.steps.map((s, i) => (
              <Badge key={i} tone={s.ok ? "neutral" : "danger"}>
                {s.ok ? <Wrench className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
                {s.tool}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
