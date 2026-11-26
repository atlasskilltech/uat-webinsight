"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SVAP, SVAP_DEFAULT_LOCALE } from "@/lib/web-agent/svap-config";

/**
 * Browser-native voice helpers for the Invoice Assistant — no dependencies, no
 * server cost. `useDictation` turns speech into text (Web Speech API); `useSpeech`
 * reads replies aloud (SpeechSynthesis). Both degrade gracefully: `supported` is
 * false where the browser lacks the API (then the UI simply hides the control).
 */

// --- Minimal typings for the (not-in-lib.dom) SpeechRecognition API ---------
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  0: SRAlternative;
  isFinal: boolean;
}
interface SRResultList {
  length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRConstructor = new () => SRInstance;

function getRecognitionCtor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Hands-free microphone dictation. Keeps listening and, each time you stop
 * speaking, emits the FINAL phrase to `onFinal` (the caller auto-sends it — no
 * Enter needed). `onInterim` streams the live partial transcript, and the hook
 * exposes it as `interim` for an on-screen indicator.
 *
 * SVAP v1.0 wiring (all timings from `svap-config.ts`):
 * - `locale` sets the recognition language (§14; default en-IN).
 * - `onSpeechStart` fires the moment the user begins speaking, so the caller can
 *   silence TTS for barge-in (§7, ≤ bargeInMs).
 * - `onNoSpeech` fires after `SVAP.noSpeechMs` of silence following activation,
 *   and the hook stops listening (§6 no-speech handling).
 * - `sendNow()` flushes the current partial transcript as a final utterance
 *   immediately (manual send, or the §6 max-utterance cap).
 */
export function useDictation(opts: {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onSpeechStart?: () => void;
  onNoSpeech?: () => void;
  locale?: string;
}): {
  supported: boolean;
  listening: boolean;
  interim: string;
  toggle: () => void;
  stop: () => void;
  sendNow: () => void;
} {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<SRInstance | null>(null);
  const wantRef = useRef(false); // true while the user wants hands-free mode on
  const partialRef = useRef(""); // latest partial transcript, for sendNow()
  const spokeRef = useRef(false); // has the user spoken in this utterance yet?
  const noSpeechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxUttTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef(opts);
  cbRef.current = opts;

  const clearTimers = useCallback(() => {
    if (noSpeechTimer.current) { clearTimeout(noSpeechTimer.current); noSpeechTimer.current = null; }
    if (maxUttTimer.current) { clearTimeout(maxUttTimer.current); maxUttTimer.current = null; }
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    clearTimers();
    partialRef.current = "";
    spokeRef.current = false;
    setListening(false);
    setInterim("");
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, [clearTimers]);

  /** Emit the current partial transcript as a final utterance right now. */
  const sendNow = useCallback(() => {
    const text = partialRef.current.trim();
    partialRef.current = "";
    setInterim("");
    if (text) cbRef.current.onFinal(text);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    wantRef.current = true;
    const begin = () => {
      if (!wantRef.current) return;
      spokeRef.current = false;
      partialRef.current = "";
      const rec = new Ctor();
      rec.lang = cbRef.current.locale || SVAP_DEFAULT_LOCALE;
      rec.interimResults = true;
      rec.continuous = false; // one phrase per recognition; we restart for hands-free

      // §6 no-speech: stop if the user says nothing for noSpeechMs after activation.
      if (noSpeechTimer.current) clearTimeout(noSpeechTimer.current);
      noSpeechTimer.current = setTimeout(() => {
        if (wantRef.current && !spokeRef.current) {
          cbRef.current.onNoSpeech?.();
          stop();
        }
      }, SVAP.noSpeechMs);

      rec.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const text = (r?.[0]?.transcript ?? "").trim();
          if (!text) continue;
          if (!spokeRef.current) {
            // first speech this utterance → barge-in signal + start the max-utterance cap
            spokeRef.current = true;
            if (noSpeechTimer.current) { clearTimeout(noSpeechTimer.current); noSpeechTimer.current = null; }
            cbRef.current.onSpeechStart?.();
            if (maxUttTimer.current) clearTimeout(maxUttTimer.current);
            maxUttTimer.current = setTimeout(() => { if (wantRef.current) sendNow(); }, SVAP.maxUtteranceMs);
          }
          if (r.isFinal) {
            partialRef.current = "";
            if (maxUttTimer.current) { clearTimeout(maxUttTimer.current); maxUttTimer.current = null; }
            setInterim("");
            cbRef.current.onFinal(text); // caller auto-sends
          } else {
            live += text;
          }
        }
        if (live) {
          partialRef.current = live;
          setInterim(live);
          cbRef.current.onInterim?.(live);
        }
      };
      rec.onerror = () => setInterim("");
      rec.onend = () => {
        recRef.current = null;
        if (wantRef.current) begin(); // keep listening until the user turns it off
        else setListening(false);
      };
      recRef.current = rec;
      try {
        rec.start();
      } catch {
        wantRef.current = false;
        clearTimers();
        setListening(false);
      }
    };
    setListening(true);
    begin();
  }, [stop, sendNow, clearTimers]);

  const toggle = useCallback(() => {
    if (wantRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(
    () => () => {
      wantRef.current = false;
      if (noSpeechTimer.current) clearTimeout(noSpeechTimer.current);
      if (maxUttTimer.current) clearTimeout(maxUttTimer.current);
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return { supported, listening, interim, toggle, stop, sendNow };
}

/**
 * Text-to-speech for reading assistant replies aloud (opt-in via `enabled`).
 * `locale` and `rate` come from SVAP §21 defaults but can be overridden (e.g.
 * the locale picker / a user rate control). Backward-compatible: called with no
 * args by the Invoice Assistant.
 */
export function useSpeech(opts?: { locale?: string; rate?: number }): {
  supported: boolean;
  enabled: boolean;
  speaking: boolean;
  setEnabled: (v: boolean) => void;
  speak: (text: string) => void;
  stop: () => void;
} {
  const [supported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
  );
  const [enabled, setEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stop = useCallback(() => {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !enabled) return;
      const clean = text.trim();
      if (!clean) return;
      try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(clean.slice(0, 4000));
        u.lang = optsRef.current?.locale || SVAP_DEFAULT_LOCALE;
        const rate = optsRef.current?.rate ?? SVAP.ttsRate;
        u.rate = Math.min(2, Math.max(0.5, rate));
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        setSpeaking(true);
        synth.speak(u);
      } catch {
        setSpeaking(false);
      }
    },
    [supported, enabled],
  );

  useEffect(
    () => () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return { supported, enabled, speaking, setEnabled, speak, stop };
}
