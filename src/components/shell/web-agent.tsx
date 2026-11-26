"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, X, Send, Mic, MicOff, Volume2, VolumeX, Sparkles, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDictation, useSpeech } from "@/lib/invoice/use-voice";
import { sendWebAgentMessage } from "@/lib/web-agent/action";

interface Msg { id: string; role: "user" | "assistant"; content: string }

const STORAGE_KEY = "web-insight-agent-chat";
const POS_KEY = "web-insight-agent-pos";
/** Other components (e.g. the topbar "Ask Agent" button) open the widget via this event. */
export const OPEN_EVENT = "web-agent:open";

const SUGGESTIONS = [
  "How many open tasks do I have?",
  "Show me overdue invoices",
  "Take me to SEO & Analytics",
  "Create a task: fix homepage meta description",
];

export function WebAgent() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // top-left; null = default bottom-right
  const panelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const tts = useSpeech();
  const mic = useDictation({ onFinal: (t) => send(t) });

  // Open from a global event (topbar button) + keyboard shortcut.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Restore chat + last position.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved).slice(-40));
      const p = localStorage.getItem(POS_KEY);
      if (p) setPos(JSON.parse(p));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch { /* ignore */ }
  }, [messages]);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, open]);

  // ── Dragging (by the header) ──
  const onDragMove = useCallback((e: PointerEvent) => {
    if (!drag.current || !panelRef.current) return;
    const w = panelRef.current.offsetWidth;
    const h = panelRef.current.offsetHeight;
    const x = Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - w - 8);
    const y = Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - h - 8);
    setPos({ x, y });
  }, []);
  const onDragEnd = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    setPos((p) => { try { if (p) localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ } return p; });
  }, [onDragMove]);
  const onDragStart = (e: React.PointerEvent) => {
    if (!panelRef.current) return;
    const r = panelRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPos({ x: r.left, y: r.top });
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  };

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
      if (res.navigate?.path) router.push(res.navigate.path);
    });
  }

  const panelStyle = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="group fixed bottom-5 right-5 z-[95] flex h-14 items-center gap-2 rounded-full bg-gradient-to-br from-accent to-accent-hover px-4 text-accent-foreground shadow-xl transition-transform hover:scale-105 focus-ring"
          aria-label="Open Web Insight Agent"
        >
          <Bot className="h-5 w-5" />
          <span className="hidden text-sm font-semibold sm:inline">Ask Agent</span>
        </button>
      )}

      {open && (
        <div
          ref={panelRef}
          style={panelStyle}
          className="fixed bottom-5 right-5 z-[95] flex h-[min(42rem,calc(100vh-2.5rem))] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl sm:w-[30rem]"
        >
          {/* Header (drag handle) */}
          <div
            onPointerDown={onDragStart}
            className="flex cursor-grab touch-none select-none items-center justify-between bg-gradient-to-r from-accent to-accent-hover px-4 py-3 text-accent-foreground active:cursor-grabbing"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <Bot className="h-4.5 w-4.5" />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold">Web Insight Agent</span>
                <span className="block text-[11px] text-white/80">Ask, navigate or act — by voice or text</span>
              </span>
            </span>
            <span className="flex items-center gap-1">
              <GripVertical className="h-4 w-4 text-white/60" aria-hidden="true" />
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-white/20" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </span>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto bg-surface-2/40 p-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
                  <Sparkles className="h-7 w-7" />
                </span>
                <p className="text-sm font-semibold text-foreground">How can I help?</p>
                <p className="mt-1 max-w-xs text-xs text-muted">
                  I can answer about SEO, tasks, issues, servers, competitors, reports and invoices — and create tasks, log
                  work, record issues, run audits or take you to any page.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:border-accent hover:text-accent"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn("flex items-end gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                  {m.role === "assistant" && (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground">
                      <Bot className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
                      m.role === "user" ? "rounded-br-sm bg-accent text-accent-foreground" : "rounded-bl-sm bg-surface text-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  </div>
                </div>
              ))
            )}
            {pending && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground"><Bot className="h-3.5 w-3.5" /></span>
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-2 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-2 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-2" />
                </span>
              </div>
            )}
            {mic.listening && (
              <p className="text-center text-xs text-accent">{mic.interim ? `“${mic.interim}”` : "Listening… speak, it sends automatically."}</p>
            )}
            <div ref={endRef} />
          </div>

          {/* Composer */}
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-1.5 border-t border-border bg-surface p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mic.listening ? "Listening…" : "Ask, say where to go, or what to do…"}
              disabled={pending}
              className="h-10 flex-1 rounded-xl border border-border bg-surface-2 px-3.5 text-sm focus-ring"
            />
            {mic.supported && (
              <button
                type="button"
                onClick={toggleVoice}
                title={mic.listening ? "Stop voice mode" : "Hands-free voice: speak and it sends automatically"}
                aria-label={mic.listening ? "Stop voice mode" : "Start voice mode"}
                className={cn("flex h-10 w-10 items-center justify-center rounded-xl border border-border", mic.listening ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground")}
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
                className={cn("flex h-10 w-10 items-center justify-center rounded-xl border border-border", tts.enabled ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground")}
              >
                {tts.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            <button type="submit" disabled={pending || !input.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
