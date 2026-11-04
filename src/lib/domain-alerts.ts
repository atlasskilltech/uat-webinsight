// Shared client-side helpers for the "site down" alert — used both by the Live
// domain monitor panel and by the global DomainAlertWatcher so the pop-up/sound
// behave identically no matter which dashboard page the user is on.

/** Remembers the user's alert on/off choice across reloads and logins. */
export const SOUND_PREF_KEY = "live-monitor-alerts";
/** Fired on the window when the alert preference changes in THIS tab (the
 *  native `storage` event only fires in other tabs). */
export const ALERTS_CHANGED_EVENT = "atlas:domain-alerts-changed";

type DownNotifyOptions = NotificationOptions & { renotify?: boolean };

// A single AudioContext for the whole tab. Once unlocked by a user gesture it
// stays usable on every page, so alerts can play without re-unlocking per page.
let audioCtx: AudioContext | null = null;

export function isAlertsOn(): boolean {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) === "on";
  } catch {
    return false;
  }
}

/** Persist the choice and notify listeners in this tab (the watcher reacts). */
export function setAlertsPref(on: boolean): void {
  try {
    localStorage.setItem(SOUND_PREF_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
  try {
    window.dispatchEvent(new CustomEvent(ALERTS_CHANGED_EVENT, { detail: on }));
  } catch {
    /* ignore */
  }
}

/** Create/resume the shared AudioContext (must be reached from a user gesture). */
export function unlockAudio(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    void audioCtx.resume();
    return audioCtx;
  } catch {
    return null; // audio unavailable — the toast/pop-up still work
  }
}

/** The shared AudioContext if it has already been unlocked, else null. */
export function getAudioContext(): AudioContext | null {
  return audioCtx;
}

/**
 * Arm a one-time listener that unlocks audio on the user's first interaction.
 * Needed because a page can load with alerts already "on" (restored), but
 * browsers only start audio after a gesture. Returns a cleanup function.
 */
export function armAudioUnlock(): () => void {
  armGestureUnlock();
  // Listeners self-remove on the first gesture; nothing to clean up by hand.
  return () => {};
}

// Whether a tune is waiting to ring once audio can play, and whether a
// first-gesture unlock listener is currently armed (so we never double-add).
let pendingTune = false;
let gestureArmed = false;

/** Arm a one-time listener that unlocks audio — and flushes a queued tune — on
 *  the user's first interaction. Browsers only start audio after a gesture. */
function armGestureUnlock(): void {
  if (typeof window === "undefined" || gestureArmed) return;
  if (audioCtx && !pendingTune) return; // already unlocked and nothing queued
  gestureArmed = true;
  const onGesture = () => {
    const ctx = unlockAudio();
    gestureArmed = false;
    window.removeEventListener("pointerdown", onGesture);
    window.removeEventListener("keydown", onGesture);
    if (pendingTune && ctx) {
      pendingTune = false;
      try {
        void ctx.resume();
        playAlertTune(ctx);
      } catch {
        /* ignore */
      }
    }
  };
  window.addEventListener("pointerdown", onGesture);
  window.addEventListener("keydown", onGesture);
}

/**
 * Ring the alert tune alongside a notification. If audio is already unlocked it
 * plays immediately; otherwise the tune is queued and rings the instant the
 * user next interacts with the page (so a notification is never left silent
 * just because audio hadn't been unlocked yet on this page load).
 */
export function ringAlertTune(): void {
  const ctx = getAudioContext();
  if (ctx) {
    try {
      void ctx.resume();
      playAlertTune(ctx);
    } catch {
      /* ignore audio errors */
    }
    return;
  }
  pendingTune = true;
  armGestureUnlock();
}

/** Synthesize a short "site down" alert tune via the Web Audio API (no asset). */
export function playAlertTune(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const notes = [
    { f: 988, t: 0 },
    { f: 740, t: 0.18 },
    { f: 554, t: 0.36 },
  ];
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.f;
    gain.gain.setValueAtTime(0.0001, now + n.t);
    gain.gain.exponentialRampToValueAtTime(0.35, now + n.t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + n.t);
    osc.stop(now + n.t + 0.18);
  }
}

/** Register the service worker (needed for notifications on mobile). */
export async function registerSw(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    /* notifications will fall back to the desktop-only path */
  }
}

/**
 * Ask for OS notification permission (must run from a user gesture) and make
 * sure the service worker is registered. Returns true if pop-ups can be shown.
 */
export async function ensureNotificationReady(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  let perm = Notification.permission;
  if (perm === "default") {
    try {
      perm = await Notification.requestPermission();
    } catch {
      perm = Notification.permission;
    }
  }
  await registerSw();
  return perm === "granted";
}

/** Show an OS-level "site down" pop-up (desktop + Android). No-op without permission. */
export async function showDownNotification(title: string, body: string, tag: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const opts: DownNotifyOptions = {
    body,
    icon: "/icon.png",
    badge: "/icon.png",
    tag,
    renotify: true,
    requireInteraction: true,
  };
  try {
    if ("serviceWorker" in navigator) {
      const reg =
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register("/sw.js"));
      await reg.showNotification(title, opts);
      return;
    }
    new Notification(title, opts);
  } catch {
    try {
      new Notification(title, opts);
    } catch {
      /* ignore — the in-app toast still fires */
    }
  }
}
