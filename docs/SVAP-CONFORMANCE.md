# SVAP v1.0 Conformance — Web Insight Agent

**Agent:** Web Insight Agent · **Conforms to:** SVAP **v1.0** (declared in `svap-config.ts` → `SVAP_VERSION`, surfaced in the widget).
**Surface:** web (Next.js app, floating widget). Voice uses the **browser-native Web Speech API** (`SpeechRecognition` + `SpeechSynthesis`) — no server audio, no new infra.

This maps every §22 checklist item to **Done / Partial / Deferred**, with where it lives and why. "Partial" and "Deferred" items are limited by the browser-native stack, not by the design — each notes what a dedicated streaming-STT backend would add.

## Single source of truth

All timings and thresholds live in **`src/lib/web-agent/svap-config.ts`** (§21). Nothing in the voice loop hard-codes a number — the hook (`use-voice.ts`) and widget (`web-agent.tsx`) read them from `SVAP`. The config is plain constants (no `server-only`) so the client and server share identical values (§20 intent).

| §21 parameter | Config key | Value |
| --- | --- | --- |
| End-of-speech threshold | `endOfSpeechMs` | 1300 ms |
| No-speech timeout | `noSpeechMs` | 8000 ms |
| Session-idle auto-end | `sessionIdleMs` | 8000 ms |
| Max-utterance length | `maxUtteranceMs` | 60000 ms |
| Barge-in stop time | `bargeInMs` | 150 ms |
| STT confidence threshold | `confidenceThreshold` | 0.60 |
| Activation latency | `activationLatencyMs` | 200 ms |
| Default locale | `SVAP_DEFAULT_LOCALE` | en-IN |
| TTS speaking rate | `ttsRate` | 1.0× |
| Capture mode default | `captureMode` | hands_free |
| Wake word | `wakeWordDefault` | false |
| Captions | `captionsDefault` | true |

## §22 Conformance Checklist

| # | Item (§) | Status | Where / notes |
| --- | --- | --- | --- |
| 1 | Space / mic start listening; Space disabled while typing (§5.1) | **Done** | `web-agent.tsx` keydown handler: Space ignored when focus is in `INPUT/TEXTAREA/SELECT`/contenteditable; mic button toggles regardless of focus. |
| 2 | Auto-send on end-of-speech silence; Space sends now; Esc cancels (§5.3) | **Partial** | Auto-send uses the browser's native endpointing (fires a `final` result on silence); `endOfSpeechMs` is the documented target but the native API does not accept a precise silence value. **Space while listening → `sendNow()`** flushes the current partial immediately. **Esc** cancels capture. A custom VAD/endpointer would make the 1.3 s exact. |
| 3 | No-speech (8 s) and max-utterance (60 s) timeouts enforced (§5.4) | **Done** | `use-voice.ts`: `noSpeechMs` timer stops listening + shows a hint; `maxUtteranceMs` timer force-sends via `sendNow()`. Both read from `SVAP`. |
| 4 | Echo cancellation prevents TTS self-capture (§5.5) | **Partial** | Mitigated in software: on first speech during TTS the utterance only barges-in (it is **not** also sent), avoiding echo-as-command. True acoustic echo cancellation is the browser/OS's job and is not guaranteed over open speakers; headset or PTT recommended there. |
| 5 | Streaming STT with live interim results; editable transcript (§6) | **Done** | `interimResults = true`; the live partial renders as a caption and streams via `onInterim`. The partial is mirrored into the **text composer**, which is fully editable before send (fallback path). |
| 6 | Locale selectable and persisted; custom vocabulary loaded (§6, §14) | **Partial** | Locale picker (en-IN/en-US/en-GB/hi-IN) persists per user in `localStorage` and drives both STT and TTS. **Custom vocabulary is deferred** — the Web Speech API has no vocabulary-injection hook; it needs a streaming-STT backend with a phrase-list/biasing API. |
| 7 | Low-confidence critical slots trigger confirm / repeat (§6) | **Partial** | `confidenceThreshold` is defined, and **every** consequential action already routes through the confirm gate (a superset of "confirm low-confidence slots"). Per-slot confidence scoring is deferred — Web Speech confidence is coarse/often absent; a backend STT would supply reliable per-token confidence. |
| 8 | Capability parity with text mode; permissions respected (§7) | **Done** | Voice and text go through the **same** `sendWebAgentMessage` / orchestrator / tool catalogue; tools are access-scoped per user (`toolsFor`). No capability is voice- or text-only. |
| 9 | Every consequential action reads back and waits for explicit confirm (§8) | **Done** | Server-side gate in `orchestrator.ts`: consequential tools (`create_task`, `add_work_log`, `record_issue`, `start_audit`) are intercepted and **never run** on the first pass — they return a `confirm` with a read-back `summary`. The widget shows a confirm card **and** speaks the read-back; execution needs an explicit spoken "yes"/click (`confirmWebAgentAction`). Ambiguous/negative = no. The gate lives on the server, so a client cannot bypass it. |
| 10 | Unattended runs hold consequential steps, never auto-confirm (§8) | **Done** | The gate is unconditional: with no confirmation there is no execution. The external Agent API (IntelligenceOS) exposes **read-only** actions, so a scheduled/unattended caller cannot trigger a write at all. |
| 11 | TTS starts on first sentence; barge-in silences within 150 ms (§9, §15) | **Partial** | **Barge-in: Done** — `onSpeechStart` and Esc/Space call `synth.cancel()` synchronously (well under 150 ms). **Sentence-level streaming: Partial** — `SpeechSynthesis` speaks the reply once the turn's text is ready; true token-streamed TTS needs a streaming audio backend. |
| 12 | Long answers summarised aloud, detail on screen (§9) | **Partial** | The system prompt instructs concise answers; full text always renders on screen while TTS reads the reply (capped length). There is no hard "never read a table aloud" guarantee beyond the prompt — a structured-output summariser would make it deterministic. |
| 13 | Auto-listen after speaking; auto-end after idle; Esc ends (§10) | **Done** | Hands-free keeps the mic cycling between turns; `noSpeechMs`/session-idle returns to Idle; Esc ends from any state. |
| 14 | Standard keymap implemented unchanged (§11) | **Done** | Space = start / send-now / barge-in (state-aware); Esc = cancel / end; mic toggles; Enter sends typed text. Space inserts a space normally when typing in the composer. |
| 15 | Four states have distinct indicators; captions in sync (§12) | **Done** | `voiceState` (Idle/Listening/Thinking/Speaking) drives a labelled colour-coded dot in the header; recording pulse while listening; thinking dots; captions (interim + messages) in sync. Colour is never the only signal (label + shape + motion). |
| 16 | Full keyboard parity; screen-reader labels; reduced-motion (§13) | **Done** | Every voice action has a key + pointer path; `role="dialog"`, `role="log" aria-live="polite"`, `aria-pressed`/`aria-label` on controls, an `sr-only` state line; all animations carry `motion-reduce:animate-none`. |
| 17 | Latency budgets met, or alerting on regression (§15) | **Partial** | Activation and barge-in are effectively instant client-side (well within budgets). End-to-end token/audio latency depends on the LLM provider; **no automated latency dashboard/alerting** yet (deferred to §19 observability). |
| 18 | All fallbacks preserve the user's words and place (§16) | **Done** | STT failure/no-speech falls back to the editable composer with the partial kept; the conversation and draft are never lost; errors report plainly and are recoverable in place. |
| 19 | Recording indicator; mic hot only while listening; audio not stored without consent (§17) | **Done** | A red recording pulse shows only while listening; the mic is started/stopped with the Listening state (not held open in Idle/Thinking/Speaking except the hands-free barge-in window); **no audio is ever stored or sent to a server** — recognition is fully in-browser. |
| 20 | Agent name, role and voice persona consistent (§18) | **Done** | "Web Insight Agent" with a one-line role in the header, consistent across the app; professional, concise tone enforced by the system prompt; honest about being an AI. |
| 21 | Actions logged with confirm metadata; no raw audio without consent (§19) | **Partial** | Executed write actions are persisted by the underlying server actions (task/log/issue/audit records, author = signed-in user). A dedicated voice **action-log with explicit confirm/by-whom metadata and voice-quality metrics** (edit/barge-in/confirm-vs-cancel rates) is deferred. No raw audio exists to log. |
| 22 | Identical behaviour across web, desktop, mobile (§20) | **Partial** | One code path → identical on web and desktop browsers. The widget is responsive and the launcher/panel are drag-friendly on touch, but **mobile touch-mapping of Space's three jobs** (start/send/interrupt) and press-and-hold PTT are not yet built. |
| 23 | Parameters read from §21 config, not hard-coded | **Done** | All timings/thresholds come from `svap-config.ts`; unit tests assert they stay within the spec's ranges. |

## Summary

- **Done:** 1, 3, 5, 8, 9, 10, 13, 14, 15, 16, 18, 19, 20, 23 (14 items)
- **Partial:** 2, 4, 6, 7, 11, 12, 17, 21, 22 (9 items) — each limited by the browser-native voice stack or by observability/mobile work, not by design.
- **Deferred (none fully blocking a web release of this agent):** the Partial notes above identify the backend work (streaming STT with confidence + custom-vocabulary biasing, streaming TTS, latency/voice-quality dashboards, mobile touch map + PTT).

**Safety-critical items are Done:** the §8 confirm gate (9, 10), capability-parity and permissions (8), the recording indicator and mic-scoping with no audio storage (19), and config-as-source-of-truth (23). No existing functionality or Invoice Agent workflow is changed — the Invoice Assistant keeps using the same `use-voice.ts` hooks (backward-compatible defaults) and its own orchestrator untouched.

## What was verified

- `tsc --noEmit` — 0 errors.
- `eslint` — 0 errors (pre-existing warnings in unrelated test files only).
- `vitest run` — 404 passing (15 in `test/web-agent.test.ts`, incl. new confirm-gate and §21-range/§8-parsing tests).
- `next build` — succeeds; client/server boundaries (`"use client"` widget, `"use server"` gate action, shared plain config) all valid.
- **Not** headless-browser-tested end-to-end: `SpeechRecognition`/`SpeechSynthesis` do not exist in headless Chromium, so the live voice loop can only be exercised in a real desktop browser. The logic around it is covered by the unit tests and the clean build.
