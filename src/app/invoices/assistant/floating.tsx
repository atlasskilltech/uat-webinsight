"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bot, X, Send, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendAgentMessageAction } from "./actions";

interface Msg { id: string; role: "user" | "assistant"; content: string }

/**
 * Floating Invoice-Agent assistant, mounted in the invoices layout so it keeps
 * its conversation while navigating between invoice pages. Dedicated to invoice
 * operations only. The conversation id is persisted to localStorage so it also
 * survives a full reload.
 */
export function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("invoice-agent-conv");
      if (saved) setConversationId(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, open]);

  function send() {
    const msg = input.trim();
    if (!msg || pending) return;
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: msg }]);
    startTransition(async () => {
      const res = await sendAgentMessageAction({ conversationId, message: msg });
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: res.assistantText || res.error || "(no response)" }]);
      if (res.conversationId && res.conversationId !== conversationId) {
        setConversationId(res.conversationId);
        try {
          localStorage.setItem("invoice-agent-conv", res.conversationId);
        } catch {
          /* ignore */
        }
      }
    });
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[90] flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg hover:bg-accent-hover focus-ring"
          aria-label="Open Invoice Assistant"
        >
          <Bot className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-[90] flex h-[32rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-accent" /> Invoice Assistant</span>
            <div className="flex items-center gap-1">
              <Link href="/invoices/assistant" className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Open full workspace">
                <Maximize2 className="h-4 w-4" />
              </Link>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">Ask about invoices, payments, duplicates or due dates. Sensitive actions need your approval.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn("max-w-[88%] rounded-lg px-3 py-2 text-sm", m.role === "user" ? "ml-auto bg-accent text-accent-foreground" : "bg-surface-2")}>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))
            )}
            {pending && <p className="text-xs text-muted">Thinking…</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-border p-2.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the agent…"
              disabled={pending}
              className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring"
            />
            <button type="submit" disabled={pending || !input.trim()} className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
