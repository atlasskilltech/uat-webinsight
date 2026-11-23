"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
 */
export function useDictation(opts: {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
}): {
  supported: boolean;
  listening: boolean;
  interim: string;
  toggle: () => void;
  stop: () => void;
} {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<SRInstance | null>(null);
  const wantRef = useRef(false); // true while the user wants hands-free mode on
  const cbRef = useRef(opts);
  cbRef.current = opts;

  const stop = useCallback(() => {
    wantRef.current = false;
    setListening(false);
    setInterim("");
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    wantRef.current = true;
    const begin = () => {
      if (!wantRef.current) return;
      const rec = new Ctor();
      rec.lang = "en-IN";
      rec.interimResults = true;
      rec.continuous = false; // one phrase per recognition; we restart for hands-free
      rec.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const text = (r?.[0]?.transcript ?? "").trim();
          if (!text) continue;
          if (r.isFinal) {
            setInterim("");
            cbRef.current.onFinal(text); // caller auto-sends
          } else {
            live += text;
          }
        }
        if (live) {
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
        setListening(false);
      }
    };
    setListening(true);
    begin();
  }, []);

  const toggle = useCallback(() => {
    if (wantRef.current) stop();
    else start();
  }, [start, stop]);

  useEffect(
    () => () => {
      wantRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return { supported, listening, interim, toggle, stop };
}

/** Text-to-speech for reading assistant replies aloud (opt-in via `enabled`). */
export function useSpeech(): {
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
        u.lang = "en-IN";
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
