"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-fetches the current server-rendered page (router.refresh), so
 * live counts — emails monitored, invoices identified, forwards — update on
 * their own while the page is open, without a manual reload. Pauses while the
 * tab is hidden to avoid needless work.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const ms = Math.max(15, seconds) * 1000;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        router.refresh();
      }
    };
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
