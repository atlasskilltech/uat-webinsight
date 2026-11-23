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

/** Microphone dictation. Emits each FINAL phrase to `onFinal`. */
export function useDictation(onFinal: (text: string) => void): {
  supported: boolean;
  listening: boolean;
  toggle: () => void;
} {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SRInstance | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r?.isFinal) {
          const text = (r[0]?.transcript ?? "").trim();
          if (text) onFinalRef.current(text);
        }
      }
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return { supported, listening, toggle };
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
