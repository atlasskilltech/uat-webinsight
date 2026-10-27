"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeft, Search, ChevronRight, Settings, LogOut } from "lucide-react";
import { activeNavItem } from "@/lib/nav";
import { ThemeToggle } from "./theme-toggle";
import { CommandPalette } from "./command-palette";
import { initials, cn } from "@/lib/utils";
import { logout } from "@/app/login/actions";
import { roleLabel, type SafeUser } from "@/lib/auth/types";

export function Topbar({
  collapsed,
  onToggleCollapse,
  onOpenMobile,
  user,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenMobile: () => void;
  user: SafeUser;
}) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = activeNavItem(pathname);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Detail routes (e.g. /inspector/<id>) get a second crumb.
  const isDetail =
    active && active.href !== "/" && pathname !== active.href;

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-md sm:px-6 no-print">
      {/* Mobile menu */}
      <button
        onClick={onOpenMobile}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground focus-ring lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>
      {/* Desktop collapse */}
      <button
        onClick={onToggleCollapse}
        className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground focus-ring lg:flex"
        aria-label="Toggle sidebar"
      >
        {collapsed ? <PanelLeft className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
      </button>

      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link href="/" className="text-muted-2 hover:text-foreground">
          ATLAS WEB INSIGHT
        </Link>
        {active && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-2" />
            <Link
              href={active.href}
              className={isDetail ? "text-muted-2 hover:text-foreground" : "truncate font-medium text-foreground"}
            >
              {active.label}
            </Link>
          </>
        )}
        {isDetail && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-2" />
            <span className="truncate font-medium text-foreground">Detail</span>
          </>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={() => setPaletteOpen(true)}
          className="hidden items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted-2 hover:bg-surface-hover sm:flex focus-ring"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search…</span>
        </button>
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground focus-ring sm:hidden"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>

        <ThemeToggle />

        <div className="relative ml-1" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-accent text-xs font-semibold uppercase text-accent-foreground focus-ring"
            title={user.name}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {initials(user.name)}
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
            >
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                <p className="truncate text-xs text-muted-2">{user.email}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-accent">{roleLabel(user.role)}</p>
              </div>
              {user.role === "admin" && (
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-surface-hover"
                  role="menuitem"
                >
                  <Settings className="h-4 w-4 text-muted-2" /> Settings
                </Link>
              )}
              <form action={logout}>
                <button
                  type="submit"
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-surface-hover",
                  )}
                  role="menuitem"
                >
                  <LogOut className="h-4 w-4 text-muted-2" /> Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} isAdmin={user.role === "admin"} />
    </header>
  );
}
