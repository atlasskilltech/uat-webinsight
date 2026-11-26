/**
 * SVAP v1.0 §21 — Configuration Parameters & Defaults.
 *
 * Single source of truth for every tunable in the voice loop. Nothing in the
 * agent hard-codes these numbers; they are read from here (SVAP §21 / §22).
 * Values are the proposed starting defaults, each within the spec's range.
 *
 * Plain constants (no "server-only"): shared by the client widget and the
 * server, so timings and gates are identical on every surface (SVAP §20).
 */
export const SVAP_VERSION = "1.0";

/**
 * SVAP §8 confirm gate: a consequential action the agent wants to take, held
 * back until the user explicitly confirms. Defined here (plain, no server-only)
 * so both the server orchestrator and the client widget share one shape.
 */
export interface PendingConfirm {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export const SVAP = {
  /** Auto-send after this much trailing silence (end-of-speech). 0.8–2.0 s. */
  endOfSpeechMs: 1300,
  /** Stop listening if nothing is said after activation. 4–15 s. */
  noSpeechMs: 8000,
  /** End the voice conversation after this much silence at the listen prompt. 5–20 s. */
  sessionIdleMs: 8000,
  /** Force-send a single utterance at this length. 20–120 s. */
  maxUtteranceMs: 60000,
  /** Silence TTS within this on barge-in. ≤ 300 ms. */
  bargeInMs: 150,
  /** Below this STT confidence, confirm or ask to repeat (where the API reports it). 0.40–0.80. */
  confidenceThreshold: 0.6,
  /** Space → listening target. ≤ 500 ms. */
  activationLatencyMs: 200,
  /** Default capture mode. */
  captureMode: "hands_free" as "hands_free" | "ptt",
  /** Wake word is opt-in only. */
  wakeWordDefault: false,
  /** Captions default on (accessibility). */
  captionsDefault: true,
  /** TTS speaking rate (user-adjustable, 0.5–2.0×). */
  ttsRate: 1.0,
} as const;

/** Locale options for the picker (SVAP §14). Default per product/region = en-IN. */
export const SVAP_LOCALES = [
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "hi-IN", label: "हिन्दी (India)" },
] as const;

export const SVAP_DEFAULT_LOCALE = "en-IN";

export function isSupportedLocale(v: string | null | undefined): v is (typeof SVAP_LOCALES)[number]["value"] {
  return !!v && SVAP_LOCALES.some((l) => l.value === v);
}

/** Affirmation / negation parsing for the confirm gate (SVAP §8): ambiguous = NO. */
export function isAffirmation(text: string): boolean {
  return /^\s*(yes|yeah|yep|yup|confirm|confirmed|go ahead|do it|proceed|ok|okay|sure|please do|affirmative)\b/i.test(text.trim());
}
export function isNegation(text: string): boolean {
  return /^\s*(no|nope|cancel|stop|don'?t|do not|abort|never mind|nevermind|wait)\b/i.test(text.trim());
}
