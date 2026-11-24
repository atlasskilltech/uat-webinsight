"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, NAV_GROUPS, activeNavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { isPathAllowedForScope, type AccessScope } from "@/lib/auth/access";
import { Tooltip } from "@/components/ui/tooltip";
import { BrandLogo } from "./brand-logo";

export function Sidebar({
  collapsed,
  isAdmin = false,
  accessScope = "full",
  onNavigate,
}: {
  collapsed: boolean;
  isAdmin?: boolean;
  accessScope?: AccessScope;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // Invoice-Agent-only users see only the modules their scope allows (the server
  // also blocks the rest — this just hides what they can't open). Within that
  // scope the Web-Insight `adminOnly` flag doesn't hide their own module's items
  // (e.g. Agent Settings), which stay governed by the invoice finance role on
  // the server. Full-access users keep the existing adminOnly behaviour.
  const visibleItems = NAV_ITEMS.filter((i) => {
    if (!isPathAllowedForScope(accessScope, i.href)) return false;
    if (accessScope === "invoice_only") return true;
    return !i.adminOnly || isAdmin;
  });
  // Highlight exactly ONE item: the deepest (longest-prefix) match for the path,
  // so a parent (/invoices) is never active on a child route (/invoices/settings).
  const activeHref = activeNavItem(pathname)?.href;

  return (
    <aside
      className={cn(
        "flex h-full flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-64",
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <BrandLogo collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const items = visibleItems.filter((i) => i.group === group.key);
          if (!items.length) return null;
          return (
            <div key={group.key} className="mb-5 last:mb-0">
              {!collapsed && (
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted/80">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = item.href === activeHref;
                  const link = (
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-sidebar-active text-white"
                          : "text-sidebar-muted hover:bg-sidebar-accent hover:text-white",
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      <item.icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          active ? "text-white" : "text-sidebar-muted group-hover:text-white",
                        )}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                  return (
                    <li key={item.href}>
                      {collapsed ? (
                        <Tooltip content={item.label} className="block">
                          {link}
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
