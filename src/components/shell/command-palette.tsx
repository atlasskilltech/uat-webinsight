"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, Plus } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

interface Command {
  label: string;
  hint?: string;
  href: string;
  keywords?: string;
  action?: boolean;
}

const QUICK_ACTIONS: Command[] = [
  { label: "New task", href: "/work?new=1", action: true, keywords: "create add work" },
  { label: "Record a technical issue", href: "/issues?new=1", action: true, keywords: "seo" },
  { label: "Inspect a page", href: "/inspector", action: true, keywords: "audit url" },
  { label: "Generate a report", href: "/reports?new=1", action: true, keywords: "weekly" },
  { label: "Add a work log", href: "/work?log=1", action: true, keywords: "daily" },
];

export function CommandPalette({
  open,
  onClose,
  isAdmin = false,
}: {
  open: boolean;
  onClose: () => void;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  // Portals need the DOM; only render after mount to stay SSR-safe.
  useEffect(() => setMounted(true), []);

  const commands = useMemo<Command[]>(
    () => [
      ...NAV_ITEMS.filter((n) => !n.adminOnly || isAdmin).map((n) => ({
        label: n.label,
        hint: n.description,
        href: n.href,
        keywords: n.description,
      })),
      ...QUICK_ACTIONS,
    ],
    [isAdmin],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && filtered[0]) {
        router.push(filtered[0].href);
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, filtered, router, onClose]);

  // Lock background scroll while the palette is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg animate-in overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-2" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules and actions…"
            className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-2"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">
              No matches
            </li>
          )}
          {filtered.map((c) => (
            <li key={c.href + c.label}>
              <button
                onClick={() => {
                  router.push(c.href);
                  onClose();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-hover"
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md",
                    c.action
                      ? "bg-accent-soft text-accent-soft-foreground"
                      : "bg-surface-2 text-muted",
                  )}
                >
                  {c.action ? <Plus className="h-3.5 w-3.5" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {c.label}
                  </span>
                  {c.hint && (
                    <span className="block truncate text-xs text-muted-2">
                      {c.hint}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
