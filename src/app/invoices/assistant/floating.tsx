"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bot, X, Send, Maximize2, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDictation, useSpeech } from "@/lib/invoice/use-voice";
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
  const tts = useSpeech();
  const mic = useDictation({ onFinal: (t) => send(t) });

  function toggleVoice() {
    const turningOn = !mic.listening;
    mic.toggle();
    if (turningOn && !tts.enabled) tts.setEnabled(true);
  }

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

  function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || pending) return;
    setInput("");
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: msg }]);
    startTransition(async () => {
      const res = await sendAgentMessageAction({ conversationId, message: msg });
      const replyText = res.assistantText || res.error || "(no response)";
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: replyText }]);
      tts.speak(replyText);
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
            {mic.listening && (
              <p className="text-xs text-accent">
                {mic.interim ? `“${mic.interim}”` : "Listening… speak, it sends automatically."}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5 border-t border-border p-2.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mic.listening ? "Listening…" : "Ask the agent…"}
              disabled={pending}
              className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring"
            />
            {mic.supported && (
              <button
                type="button"
                onClick={toggleVoice}
                title={mic.listening ? "Stop voice mode" : "Hands-free voice: speak and it sends automatically"}
                aria-label={mic.listening ? "Stop voice mode" : "Start voice mode"}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg border border-border",
                  mic.listening ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {mic.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            {tts.supported && (
              <button
                type="button"
                onClick={() => { const next = !tts.enabled; tts.setEnabled(next); if (!next) tts.stop(); }}
                title={tts.enabled ? "Replies read aloud (on)" : "Read replies aloud"}
                aria-label={tts.enabled ? "Turn off read aloud" : "Turn on read aloud"}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg border border-border",
                  tts.enabled ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {tts.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            <button type="submit" disabled={pending || !input.trim()} className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
