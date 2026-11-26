"use client";

import { useEffect } from "react";

/**
 * Self-heal client-side navigation that fails because the browser tab is
 * holding JavaScript chunks from a previous deploy. When a `<Link>` navigation
 * (or a prefetch) tries to load a chunk that no longer exists, the browser
 * raises a ChunkLoadError and the navigation silently fails — the page "doesn't
 * open". Heavier pages (e.g. SEO & Analytics, with charts) hit this first
 * because they load the most/ largest chunks.
 *
 * This listens for those errors and does a single full reload, which fetches
 * fresh HTML referencing the current chunks, so the page then opens. A short
 * guard (once per 8s, remembered for this tab) prevents a reload loop if a
 * chunk is genuinely, permanently missing.
 */
const CHUNK_ERROR = /ChunkLoadError|Loading chunk [^\s]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

function isChunkError(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") return CHUNK_ERROR.test(value);
  const err = value as { name?: string; message?: string };
  return CHUNK_ERROR.test(String(err.name ?? "")) || CHUNK_ERROR.test(String(err.message ?? ""));
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
      // Full reload: fetches fresh HTML with the current chunk references.
      window.location.reload();
    };

    const onError = (e: ErrorEvent) => {
      if (isChunkError(e.error) || isChunkError(e.message)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkError(e.reason)) reloadOnce();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
