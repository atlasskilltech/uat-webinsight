"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { checkMonitoredDomainsAction } from "@/app/operations/actions";
import type { DomainStatusRow } from "@/lib/domain-monitor";
import {
  ALERTS_CHANGED_EVENT,
  armAudioUnlock,
  isAlertsOn,
  registerSw,
  ringAlertTune,
  showDownNotification,
} from "@/lib/domain-alerts";

const POLL_MS = 10_000;

/**
 * Runs on every dashboard page (mounted in AppShell) so a "site down" pop-up
 * reaches the user wherever they are — not only on the Server Inventory page.
 *
 * It only polls while alerts are enabled (the bell toggle). On the first poll
 * after enabling / opening the dashboard it surfaces anything already down (so
 * opening the app to an existing outage notifies you); after that it alerts
 * only on a fresh down, so a persistently-down site doesn't re-alert every 10s.
 *
 * Renders nothing. The Live domain monitor panel shows the table; this is the
 * single source of alerting, so the panel itself no longer fires alerts.
 */
export function DomainAlertWatcher() {
  const toast = useToast();

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let disarmAudio: () => void = () => {};
    const prevStates = new Map<string, string>();
    let firstLoad = true;

    const down = (r: DomainStatusRow) => r.monitorState === "down";

    const poll = async () => {
      if (!isAlertsOn()) return;
      try {
        const rows = await checkMonitoredDomainsAction();
        if (!active) return;

        const alerting = firstLoad
          ? rows.filter(down)
          : rows.filter((r) => down(r) && prevStates.get(r.id) !== "down");
        firstLoad = false;
        prevStates.clear();
        for (const r of rows) prevStates.set(r.id, r.monitorState ?? "");

        if (alerting.length === 0) return;
        const single = alerting.length === 1 ? alerting[0] : null;
        const title = single ? `${single.name} is down` : `${alerting.length} sites are down`;
        const body = single
          ? single.url || single.name
          : alerting.slice(0, 5).map((r) => r.name).join(", ") + (alerting.length > 5 ? "…" : "");
        const tag = single ? `down-${single.id}` : "down-multi";

        toast(title, "error");
        void showDownNotification(title, body, tag);
        ringAlertTune();
      } catch {
        /* transient — try again next tick */
      }
    };

    const start = () => {
      if (timer) return;
      void registerSw();
      disarmAudio = armAudioUnlock();
      void poll();
      timer = setInterval(() => void poll(), POLL_MS);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      disarmAudio();
      disarmAudio = () => {};
      // Reset the baseline so re-enabling re-surfaces anything currently down.
      firstLoad = true;
      prevStates.clear();
    };

    if (isAlertsOn()) start();

    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === true || isAlertsOn()) start();
      else stop();
    };
    window.addEventListener(ALERTS_CHANGED_EVENT, onChange);

    return () => {
      active = false;
      window.removeEventListener(ALERTS_CHANGED_EVENT, onChange);
      if (timer) clearInterval(timer);
      disarmAudio();
    };
    // toast is stable (from context); run this setup once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
