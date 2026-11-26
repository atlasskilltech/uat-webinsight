import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ListChecks,
  LineChart,
  SearchCheck,
  TriangleAlert,
  ServerCog,
  Telescope,
  FileText,
  Settings,
  Users,
  Receipt,
  SlidersHorizontal,
  Mail,
  KeyRound,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  group: "overview" | "work" | "website" | "ops" | "finance" | "system" | "admin";
  /** Only shown to admins (server-side authorization is enforced separately). */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Executive Dashboard",
    icon: LayoutDashboard,
    description: "At-a-glance view of work, website performance and priorities.",
    group: "overview",
  },
  {
    href: "/work",
    label: "My Work",
    icon: ListChecks,
    description: "Tasks, daily work logs and summaries of what you've done.",
    group: "work",
  },
  {
    href: "/seo",
    label: "SEO & Analytics",
    icon: LineChart,
    description: "Search Console and GA4 performance for the website.",
    group: "website",
  },
  {
    href: "/inspector",
    label: "Page Inspector",
    icon: SearchCheck,
    description: "Audit individual URLs and run the diagnostic engine.",
    group: "website",
  },
  {
    href: "/issues",
    label: "Technical SEO Issues",
    icon: TriangleAlert,
    description: "Register of technical issues linked to audited pages.",
    group: "website",
  },
  {
    href: "/operations",
    label: "Backend & Server",
    icon: ServerCog,
    description: "Server inventory and an operations log for your infra work.",
    group: "ops",
  },
  {
    href: "/competitors",
    label: "Competitor Intelligence",
    icon: Telescope,
    description: "Structured research into what other institutions do well.",
    group: "ops",
  },
  {
    href: "/reports",
    label: "Reports & History",
    icon: FileText,
    description: "Generate management-ready weekly and monthly reports.",
    group: "ops",
  },
  {
    href: "/invoices",
    label: "Invoice Agent",
    icon: Receipt,
    description: "Monitoring status and what the agent has done.",
    group: "finance",
  },
  {
    href: "/invoices/email-accounts",
    label: "Connected Accounts",
    icon: Mail,
    description: "Connect and monitor company Gmail inboxes.",
    group: "finance",
  },
  {
    href: "/invoices/settings",
    label: "Agent Settings",
    icon: SlidersHorizontal,
    description: "Finance & Accounts destination, forwarding and permissions.",
    group: "finance",
    adminOnly: true,
  },
  {
    href: "/settings",
    label: "Settings & Integrations",
    icon: Settings,
    description: "Website property, integrations, imports and preferences.",
    group: "system",
    adminOnly: true,
  },
  {
    href: "/settings/agent-api",
    label: "Agent API",
    icon: KeyRound,
    description: "Connect IntelligenceOS: generate keys so the super agent can read this workspace.",
    group: "system",
    adminOnly: true,
  },
  {
    href: "/admin/users",
    label: "User Management",
    icon: Users,
    description: "Manage accounts, roles and access (admins only).",
    group: "admin",
    adminOnly: true,
  },
];

export const NAV_GROUPS: { key: NavItem["group"]; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "work", label: "Work" },
  { key: "website", label: "Website" },
  { key: "ops", label: "Operations" },
  { key: "finance", label: "Invoice Agent" },
  { key: "system", label: "System" },
  { key: "admin", label: "Administration" },
];

/**
 * The single nav item to highlight for a path. Longest-prefix match on a path
 * SEGMENT boundary, so:
 *  - /work/123 maps to /work,
 *  - /invoices/settings highlights only "Agent Settings" (NOT its parent
 *    /invoices "Invoice Agent"), and
 *  - /invoicesX does NOT match /invoices.
 * Returns undefined when nothing matches.
 */
export function activeNavItem(pathname: string, items: NavItem[] = NAV_ITEMS): NavItem | undefined {
  return [...items]
    .filter((i) =>
      i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(`${i.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
}
