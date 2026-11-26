"use client";

import { useEffect } from "react";

/**
 * Self-heal client-side navigation that fails because the browser tab is
 * holding JavaScript chunks from a previous deploy. When a `<Link>` navigation
 * tries to load a chunk that no longer exists (after a redeploy), the chunk
 * `<script>` fails to load and the navigation silently dies — the page "doesn't
 * open". Heavier pages (e.g. SEO & Analytics, with charts) hit this first
 * because they load the most/largest chunks.
 *
 * Catching this reliably needs TWO things that the obvious approach misses:
 *  1. A failed `<script>`/`<link>` resource error does NOT bubble, so the
 *     window "error" listener must be registered in the CAPTURE phase.
 *  2. The event for a failed resource has no useful `message`; the signal is
 *     `event.target` being a SCRIPT/LINK pointing at `/_next/static/`.
 *
 * On such an error we do a single full reload, which fetches fresh HTML that
 * references the current chunks — so the page then opens. The in-flight
 * navigation has already updated the URL to the destination, so reloading lands
 * on the page the user clicked. A per-tab 8s guard prevents a reload loop if a
 * chunk is genuinely, permanently missing.
 */
const CHUNK_MESSAGE =
  /ChunkLoadError|Loading chunk [^\s]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

const STATIC_ASSET = /\/_next\/static\//;

function messageLooksLikeChunk(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") return CHUNK_MESSAGE.test(value);
  const err = value as { name?: string; message?: string };
  return CHUNK_MESSAGE.test(String(err.name ?? "")) || CHUNK_MESSAGE.test(String(err.message ?? ""));
}

/** A failed `<script>`/`<link>` load for a Next static asset (a stale chunk). */
function isFailedChunkAsset(target: EventTarget | null): boolean {
  const el = target as (HTMLScriptElement & HTMLLinkElement) | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag !== "SCRIPT" && tag !== "LINK") return false;
  const url = el.src || el.href || "";
  return STATIC_ASSET.test(url);
}

export function ChunkReloadRecovery() {
  useEffect(() => {
    const KEY = "cwi:last-chunk-reload";

    const reloadOnce = () => {
      try {
        const last = Number(sessionStorage.getItem(KEY) || "0");
        if (Date.now() - last < 8000) return; // already tried very recently — don't loop
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* sessionStorage unavailable — still attempt one reload */
      }
      // The in-flight navigation already set the URL to the destination, so a
      // reload opens the page the user clicked (with fresh chunk references).
      window.location.reload();
    };

    // Capture phase so we also see resource-load errors (which don't bubble).
    const onErrorCapture = (e: Event) => {
      if (isFailedChunkAsset(e.target) || messageLooksLikeChunk((e as ErrorEvent).error) || messageLooksLikeChunk((e as ErrorEvent).message)) {
        reloadOnce();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (messageLooksLikeChunk(e.reason)) reloadOnce();
    };

    window.addEventListener("error", onErrorCapture, true); // capture
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onErrorCapture, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
