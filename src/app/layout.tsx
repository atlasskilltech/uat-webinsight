import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser } from "@/lib/auth/session";

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
