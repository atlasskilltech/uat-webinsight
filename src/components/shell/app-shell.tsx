"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SafeUser } from "@/lib/auth/types";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: SafeUser;
}) {
  const isAdmin = user.role === "admin";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restore collapse preference.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("atlas:sidebar-collapsed");
      if (saved === "1") setCollapsed(true);
    } catch {}
  }, []);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("atlas:sidebar-collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block no-print">
        <Sidebar collapsed={collapsed} isAdmin={isAdmin} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 animate-in">
            <Sidebar collapsed={false} isAdmin={isAdmin} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onOpenMobile={() => setMobileOpen(true)}
          user={user}
        />
        <main
          className={cn(
            "flex-1 overflow-y-auto print-container",
            "px-4 py-6 sm:px-6 lg:px-8",
          )}
        >
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
