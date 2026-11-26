"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, X, Send, Mic, MicOff, Volume2, VolumeX, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDictation, useSpeech } from "@/lib/invoice/use-voice";
import { sendWebAgentMessage } from "@/lib/web-agent/action";

interface Msg { id: string; role: "user" | "assistant"; content: string }

const STORAGE_KEY = "web-insight-agent-chat";

/**
 * The Web Insight Agent: a floating, voice-enabled assistant mounted app-wide.
 * It answers about every module and can navigate the user to pages (so they can
 * drive the app largely hands-free). Read + navigate only. Stateless on the
 * server — the recent conversation is sent back each turn.
 */
export function WebAgent() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const tts = useSpeech();
  const mic = useDictation({ onFinal: (t) => send(t) });

  // Restore the recent conversation (survives reloads).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved).slice(-30));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      /* ignore */
    }
  }, [messages]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, open]);

  function toggleVoice() {
    const turningOn = !mic.listening;
    mic.toggle();
    if (turningOn && !tts.enabled) tts.setEnabled(true);
  }

  function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || pending) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: msg }]);
    startTransition(async () => {
      const res = await sendWebAgentMessage({ history, message: msg });
      const replyText = res.assistantText || res.error || "(no response)";
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: replyText }]);
      tts.speak(replyText);
      if (res.navigate?.path) {
        // Take the user to the page the agent chose.
        router.push(res.navigate.path);
      }
    });
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[90] flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg hover:bg-accent-hover focus-ring"
          aria-label="Open Web Insight Agent"
        >
          <Bot className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-[90] flex h-[32rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="h-4 w-4 text-accent" /> Web Insight Agent
            </span>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-surface-hover hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">
                <Compass className="mx-auto mb-2 h-6 w-6 text-accent" />
                Ask about anything — SEO, tasks, issues, servers, competitors, reports or invoices. Or say
                <span className="text-foreground"> “take me to SEO”</span> and I&apos;ll open the page for you.
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn("max-w-[88%] rounded-lg px-3 py-2 text-sm", m.role === "user" ? "ml-auto bg-accent text-accent-foreground" : "bg-surface-2")}>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))
            )}
            {pending && <p className="text-xs text-muted">Thinking…</p>}
            {mic.listening && (
              <p className="text-xs text-accent">{mic.interim ? `“${mic.interim}”` : "Listening… speak, it sends automatically."}</p>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5 border-t border-border p-2.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mic.listening ? "Listening…" : "Ask or say where to go…"}
              disabled={pending}
              className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus-ring"
            />
            {mic.supported && (
              <button
                type="button"
                onClick={toggleVoice}
                title={mic.listening ? "Stop voice mode" : "Hands-free voice: speak and it sends automatically"}
                aria-label={mic.listening ? "Stop voice mode" : "Start voice mode"}
                className={cn("flex h-9 w-9 items-center justify-center rounded-lg border border-border", mic.listening ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground")}
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
                className={cn("flex h-9 w-9 items-center justify-center rounded-lg border border-border", tts.enabled ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground")}
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
