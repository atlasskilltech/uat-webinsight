"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, X, Send, Mic, MicOff, Volume2, VolumeX, Sparkles, GripVertical, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDictation, useSpeech } from "@/lib/invoice/use-voice";
import { sendWebAgentMessage, confirmWebAgentAction } from "@/lib/web-agent/action";
import {
  SVAP_LOCALES,
  SVAP_DEFAULT_LOCALE,
  SVAP_VERSION,
  isSupportedLocale,
  isAffirmation,
  isNegation,
  type PendingConfirm,
} from "@/lib/web-agent/svap-config";
import { applyTtsLexicon } from "@/lib/web-agent/vocabulary";
import { type Anchored, DEFAULT_POS, anchoredStyle, toAnchored, clampAnchored, isAnchored } from "@/lib/web-agent/anchor";

interface Msg { id: string; role: "user" | "assistant"; content: string }

const STORAGE_KEY = "web-insight-agent-chat";
const POS_KEY = "web-insight-agent-pos";
const LAUNCHER_KEY = "web-insight-agent-launcher-pos";
const LOCALE_KEY = "web-insight-agent-locale";
/** Other components (e.g. the topbar "Ask Agent" button) open the widget via this event. */
export const OPEN_EVENT = "web-agent:open";

/** SVAP §4 voice states. */
type VoiceState = "idle" | "listening" | "thinking" | "speaking";
const STATE_LABEL: Record<VoiceState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const SUGGESTIONS = [
  "How many open tasks do I have?",
  "Show me overdue invoices",
  "Take me to SEO & Analytics",
  "Create a task: fix homepage meta description",
];

/** Re-clamp against the live viewport using an element's measured size. */
function clampToView(a: Anchored, el: HTMLElement | null): Anchored {
  if (!el) return a;
  return clampAnchored(a, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
}

export function WebAgent() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [pos, setPos] = useState<Anchored>(DEFAULT_POS); // panel, edge-anchored
  const [launcherPos, setLauncherPos] = useState<Anchored>(DEFAULT_POS); // launcher, edge-anchored
  const [locale, setLocale] = useState<string>(SVAP_DEFAULT_LOCALE);
  const [confirmReq, setConfirmReq] = useState<PendingConfirm | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ldrag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const tts = useSpeech({ locale, rate: 1, transform: applyTtsLexicon });
  // Refs so the voice callbacks (registered once) always see current state.
  const speakingRef = useRef(false);
  speakingRef.current = tts.speaking;
  const confirmRef = useRef<PendingConfirm | null>(null);
  confirmRef.current = confirmReq;

  // SVAP §4/§7: route a spoken final utterance by the current mode. A plain
  // function (recreated each render) so it always closes over current state —
  // the voice hook reads the latest callback from its own ref at event time.
  function handleVoiceFinal(text: string) {
    // §7 barge-in: if TTS was talking when the user spoke, that utterance only
    // interrupts speech — don't also treat it as a command (avoids echo sends).
    if (speakingRef.current) { tts.stop(); return; }
    const t = text.trim();
    if (!t) return;
    // §8 confirm gate: while an action awaits confirmation, yes/no only.
    const pc = confirmRef.current;
    if (pc) {
      if (isAffirmation(t)) runConfirm(pc);
      else if (isNegation(t)) cancelConfirm();
      else speakAndLog(`Please say "yes" to ${pc.summary.replace(/\.$/, "")} or "no" to cancel.`, false);
      return;
    }
    send(t);
  }

  const mic = useDictation({
    onFinal: (t) => handleVoiceFinal(t),
    onSpeechStart: () => { if (speakingRef.current) tts.stop(); }, // §7 barge-in
    // §16: no speech after activation — the hook stops; show a short hint.
    onNoSpeech: () => setMessages((m) => [...m, { id: `h-${Date.now()}`, role: "assistant", content: "Didn't catch that — press Space or tap the mic to try again." }]),
    locale,
  });
  const micRef = useRef(mic);
  micRef.current = mic;

  // Open from a global event (topbar button).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Each page load starts a FRESH chat — the conversation is never restored, so
  // a refresh clears it. (Only the widget position and chosen language persist.)
  // Also clear any chat an older build saved to localStorage.
  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      const p = localStorage.getItem(POS_KEY);
      if (p) { const v = JSON.parse(p); if (isAnchored(v)) setPos(v); } // ignore old {x,y} format
      const lp = localStorage.getItem(LAUNCHER_KEY);
      if (lp) { const v = JSON.parse(lp); if (isAnchored(v)) setLauncherPos(v); }
      const loc = localStorage.getItem(LOCALE_KEY);
      if (isSupportedLocale(loc)) setLocale(loc);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* ignore */ }
  }, [locale]);

  // Keep the widget on-screen through window resize / minimise / maximise /
  // rotate: re-clamp whichever element is mounted (panel when open, else launcher).
  useEffect(() => {
    const onResize = () => {
      setPos((p) => clampToView(p, panelRef.current));
      setLauncherPos((p) => clampToView(p, launcherRef.current));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  // When the panel opens, make sure a position saved on a larger screen still fits.
  useEffect(() => {
    if (open) setPos((p) => clampToView(p, panelRef.current));
  }, [open]);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, open, confirmReq]);

  // ── SVAP §5 keyboard: Space toggles mic, Esc cancels/stops ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (e.code === "Space" && !typing && micRef.current.supported) {
        // §5.3/§11 Space is state-aware: speaking → barge-in; listening → send
        // now; idle → start listening.
        e.preventDefault();
        if (speakingRef.current) {
          tts.stop();
          if (!micRef.current.listening) toggleVoice();
        } else if (micRef.current.listening) {
          micRef.current.sendNow();
        } else {
          toggleVoice();
        }
      } else if (e.key === "Escape") {
        // most-urgent-first: dismiss confirm → stop speech → stop listening
        if (confirmRef.current) { e.preventDefault(); cancelConfirm(); }
        else if (speakingRef.current) { e.preventDefault(); tts.stop(); }
        else if (micRef.current.listening) { e.preventDefault(); micRef.current.stop(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Dragging (by the header) ──
  const onDragMove = useCallback((e: PointerEvent) => {
    if (!drag.current || !panelRef.current) return;
    setPos(toAnchored(e.clientX - drag.current.dx, e.clientY - drag.current.dy, panelRef.current.offsetWidth, panelRef.current.offsetHeight, window.innerWidth, window.innerHeight));
  }, []);
  const onDragEnd = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    setPos((p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ } return p; });
  }, [onDragMove]);
  const onDragStart = (e: React.PointerEvent) => {
    if (!panelRef.current) return;
    const r = panelRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  };

  // ── Dragging the floating launcher (press to move; tap to open) ──
  const onLauncherMove = useCallback((e: PointerEvent) => {
    if (!ldrag.current || !launcherRef.current) return;
    const dx = e.clientX - ldrag.current.sx;
    const dy = e.clientY - ldrag.current.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) ldrag.current.moved = true;
    setLauncherPos(toAnchored(ldrag.current.ox + dx, ldrag.current.oy + dy, launcherRef.current.offsetWidth, launcherRef.current.offsetHeight, window.innerWidth, window.innerHeight));
  }, []);
  const onLauncherUp = useCallback(() => {
    window.removeEventListener("pointermove", onLauncherMove);
    window.removeEventListener("pointerup", onLauncherUp);
    const moved = ldrag.current?.moved;
    ldrag.current = null;
    if (!moved) {
      setOpen(true); // it was a tap, not a drag
    } else {
      setLauncherPos((p) => { try { localStorage.setItem(LAUNCHER_KEY, JSON.stringify(p)); } catch { /* ignore */ } return p; });
    }
  }, [onLauncherMove]);
  const onLauncherDown = (e: React.PointerEvent) => {
    if (!launcherRef.current) return;
    const r = launcherRef.current.getBoundingClientRect();
    ldrag.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
    window.addEventListener("pointermove", onLauncherMove);
    window.addEventListener("pointerup", onLauncherUp);
  };

  function toggleVoice() {
    const turningOn = !micRef.current.listening;
    micRef.current.toggle();
    if (turningOn && !tts.enabled) tts.setEnabled(true);
  }

  /** Append an assistant line and (if TTS on) read it aloud. */
  function speakAndLog(text: string, pushMsg = true) {
    if (pushMsg) setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: text }]);
    tts.speak(text);
  }

  function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || pending) return;
    setInput("");
    setConfirmReq(null);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: msg }]);
    startTransition(async () => {
      const res = await sendWebAgentMessage({ history, message: msg });
      const replyText = res.assistantText || res.error || "(no response)";
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: replyText }]);
      // §8: a consequential action needs an explicit confirm before it runs.
      if (res.confirm) {
        setConfirmReq(res.confirm);
        tts.speak(`${res.confirm.summary} Shall I go ahead? Say yes or no.`);
        return;
      }
      tts.speak(replyText);
      if (res.navigate?.path) router.push(res.navigate.path);
    });
  }

  /** §8: user confirmed — actually run the held-back action. */
  function runConfirm(pc: PendingConfirm) {
    if (pending) return;
    setConfirmReq(null);
    startTransition(async () => {
      const res = await confirmWebAgentAction({ tool: pc.tool, args: pc.args });
      const replyText = res.assistantText || res.error || "Done.";
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: replyText }]);
      tts.speak(replyText);
      if (res.navigate?.path) router.push(res.navigate.path);
    });
  }

  function cancelConfirm() {
    setConfirmReq(null);
    speakAndLog("Okay, cancelled — nothing was changed.");
  }

  const voiceState: VoiceState = pending ? "thinking" : tts.speaking ? "speaking" : mic.listening ? "listening" : "idle";
  const panelStyle = anchoredStyle(pos);
  const dotColor: Record<VoiceState, string> = {
    idle: "bg-white/50",
    listening: "bg-red-300",
    thinking: "bg-amber-300",
    speaking: "bg-emerald-300",
  };

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          onPointerDown={onLauncherDown}
          style={anchoredStyle(launcherPos)}
          className="fixed z-[95] flex h-14 w-14 touch-none items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-hover text-accent-foreground shadow-xl transition-transform hover:scale-105 focus-ring"
          aria-label="Web Insight Agent — tap to open, drag to move"
          title="Tap to ask · drag to move"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div
          ref={panelRef}
          style={panelStyle}
          role="dialog"
          aria-label="Web Insight Agent"
          className="fixed z-[95] flex h-[min(42rem,calc(100dvh-2.5rem))] max-h-[calc(100dvh-2.5rem)] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl sm:w-[30rem]"
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
                <span className="flex items-center gap-1.5 text-[11px] text-white/80">
                  <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotColor[voiceState], voiceState === "listening" && "animate-pulse motion-reduce:animate-none")} aria-hidden="true" />
                  {STATE_LABEL[voiceState]}
                </span>
              </span>
            </span>
            <span className="flex items-center gap-1">
              {/* §14 locale picker */}
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                title="Voice language"
                aria-label="Voice language"
                className="mr-1 rounded-md bg-white/15 px-1.5 py-1 text-[11px] text-white focus-ring [&>option]:text-foreground"
              >
                {SVAP_LOCALES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              <GripVertical className="h-4 w-4 text-white/60" aria-hidden="true" />
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-white/20" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </span>
          </div>

          {/* Messages */}
          <div role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto bg-surface-2/40 p-4">
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
                <p className="mt-2 text-[11px] text-muted-2">Press <kbd className="rounded border border-border px-1">Space</kbd> to talk · <kbd className="rounded border border-border px-1">Esc</kbd> to stop</p>
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

            {/* §8 confirm card (click fallback for the spoken yes/no) */}
            {confirmReq && (
              <div className="rounded-xl border border-amber-400/50 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">
                <p className="font-medium text-foreground">Confirm this action</p>
                <p className="mt-0.5 text-foreground/90">{confirmReq.summary}</p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => runConfirm(confirmReq)}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Yes, do it
                  </button>
                  <button
                    onClick={cancelConfirm}
                    disabled={pending}
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
                  >
                    No, cancel
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted">Or say “yes” / “no”.</p>
              </div>
            )}

            {pending && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground"><Bot className="h-3.5 w-3.5" /></span>
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-2 [animation-delay:-0.2s] motion-reduce:animate-none" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-2 [animation-delay:-0.1s] motion-reduce:animate-none" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-2 motion-reduce:animate-none" />
                </span>
              </div>
            )}
            {mic.listening && (
              <p className="flex items-center justify-center gap-2 text-center text-xs text-accent">
                <span className="inline-block h-2 w-2 animate-ping rounded-full bg-red-500 motion-reduce:animate-none" aria-hidden="true" />
                {mic.interim ? `“${mic.interim}”` : "Listening… speak, it sends automatically."}
              </p>
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
                title={mic.listening ? "Stop voice mode (Esc)" : "Hands-free voice (Space): speak and it sends automatically"}
                aria-label={mic.listening ? "Stop voice mode" : "Start voice mode"}
                aria-pressed={mic.listening}
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
                aria-pressed={tts.enabled}
                className={cn("flex h-10 w-10 items-center justify-center rounded-xl border border-border", tts.enabled ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground")}
              >
                {tts.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            <button type="submit" disabled={pending || !input.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground disabled:opacity-50">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="sr-only">SVAP voice protocol v{SVAP_VERSION}. Current state: {STATE_LABEL[voiceState]}.</p>
        </div>
      )}
    </>
  );
}
