import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { isPathAllowedForScope } from "@/lib/auth/access";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ATLAS WEB INSIGHT",
    template: "%s · ATLAS WEB INSIGHT",
  },
  description:
    "Central workspace for managing work, website SEO performance, technical issues, server operations and weekly reporting at ATLAS University.",
};

// Pages reachable without a session.
const PUBLIC_PREFIXES = ["/login"];
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const publicPage = isPublicPath(pathname);

  // Authoritative server-side auth check (middleware only does a cookie-presence
  // redirect; this validates the actual session).
  const user = publicPage ? null : await getCurrentUser();
  if (!publicPage && !user) redirect("/login");

  // Module access scope (read fresh from the DB each request, so a change takes
  // effect on the next request): an Invoice-Agent-only user may not open any
  // restricted-module page by URL — send them to the Invoice Agent. This is the
  // authoritative server-side block for direct-URL access to restricted pages.
  if (user && !publicPage && !isPathAllowedForScope(user.accessScope, pathname)) {
    redirect("/invoices");
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>
          {user ? <AppShell user={user}>{children}</AppShell> : children}
        </Providers>
      </body>
    </html>
  );
}
