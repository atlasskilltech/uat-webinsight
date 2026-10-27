import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Image from "next/image";
import { BarChart3, SearchCheck, FileText, Zap, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { getCurrentUser } from "@/lib/auth/session";
import { googleSignInAction } from "./actions";
import { GoogleSignInButton } from "./google-signin-button";
import { DashboardPreview } from "./dashboard-preview";
import { AtlasLogo } from "./atlas-logo";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "This Google account isn't approved for access. Ask an administrator to add it in User Management.",
  Configuration: "Sign-in isn't configured correctly. Please contact an administrator.",
};

const FEATURES = [
  { icon: BarChart3, label: "Track\nPerformance", tint: "from-blue-500/20 to-blue-500/5 text-blue-300" },
  { icon: SearchCheck, label: "Improve\nSEO", tint: "from-teal-500/20 to-teal-500/5 text-teal-300" },
  { icon: FileText, label: "Manage\nContent", tint: "from-emerald-500/20 to-emerald-500/5 text-emerald-300" },
  { icon: Zap, label: "Get\nActionable Insights", tint: "from-indigo-500/20 to-indigo-500/5 text-indigo-300" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) {
    redirect(sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/");
  }
  const errorMessage = sp.error ? ERROR_MESSAGES[sp.error] ?? "Could not sign in. Please try again." : null;
  const nextValue = sp.next ?? "/";

  return (
    <div className="relative min-h-dvh w-full overflow-x-hidden bg-slate-950 lg:grid lg:grid-cols-[1.65fr_1fr] xl:grid-cols-[1.8fr_1fr]">
      {/* ================= LEFT — dark analytics showcase (desktop only) ======= */}
      <section className="relative isolate hidden flex-col justify-between overflow-hidden bg-[#0a1020] px-8 py-10 text-white lg:flex xl:px-14 xl:py-12">
        {/* Ambient gradients + curved lines */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl motion-safe:animate-pulse" />
          <div className="absolute right-0 top-1/3 h-80 w-80 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-blue-700/20 blur-3xl" />
          <svg className="absolute inset-0 h-full w-full opacity-40" viewBox="0 0 800 900" fill="none" preserveAspectRatio="xMidYMid slice">
            <path d="M-50 250 Q 300 120 850 360" stroke="url(#g1)" strokeWidth="1.5" />
            <path d="M-50 360 Q 350 220 850 480" stroke="url(#g1)" strokeWidth="1" />
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="800" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#60a5fa" stopOpacity="0" />
                <stop offset="0.5" stopColor="#60a5fa" stopOpacity="0.45" />
                <stop offset="1" stopColor="#2dd4bf" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Top row: brand + pill */}
        <div className="relative flex items-center justify-between gap-4">
          <Image
            src="/brand/atlas-logo-full.png"
            alt="Atlas Web Insight"
            width={1893}
            height={608}
            priority
            className="h-11 w-auto xl:h-12"
          />
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 backdrop-blur">
            <BarChart3 className="h-3.5 w-3.5 text-sky-300" />
            Website &amp; Work Intelligence
          </span>
        </div>

        {/* Headline + features */}
        <div className="relative mt-8">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
            Smarter Insights
            <br />
            <span className="bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-300 bg-clip-text text-transparent">
              A Stronger Atlas
            </span>
          </h1>
          <p className="mt-4 text-base text-slate-300/90">Monitor. Analyze. Improve. All in one place.</p>

          <div className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.label} className="flex items-start gap-2.5">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${f.tint} ring-1 ring-white/10`}>
                  <f.icon className="h-5 w-5" />
                </span>
                <span className="whitespace-pre-line text-sm font-medium leading-tight text-slate-200">{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard preview */}
        <div className="relative mt-9">
          <DashboardPreview />
        </div>

        {/* Soft floor fade */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0a1020] to-transparent" />
      </section>

      {/* ================= RIGHT — login panel ================================= */}
      <section className="relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-indigo-100 dark:from-slate-900 dark:via-slate-950 dark:to-indigo-950">
        <div className="absolute right-4 top-4 z-20">
          <ThemeToggle />
        </div>

        {/* --- Card area (grows to fill space above the building strip) --- */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-6 pt-14 sm:px-8">
          {/* Compact hero for mobile (left showcase is hidden there) */}
          <div className="mb-6 w-full max-w-md text-center lg:hidden">
            <h1 className="text-2xl font-semibold leading-tight text-slate-900 dark:text-white">
              Smarter Insights,{" "}
              <span className="bg-gradient-to-r from-blue-600 to-teal-500 bg-clip-text text-transparent dark:from-blue-400 dark:to-teal-300">
                A Stronger Atlas
              </span>
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Monitor. Analyze. Improve. All in one place.</p>
          </div>

          {/* Login card */}
          <div className="relative w-full max-w-md rounded-2xl bg-white p-7 shadow-xl ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10 sm:p-8">
            <AtlasLogo tone="light" size="md" className="dark:hidden" />
            <AtlasLogo tone="dark" size="md" className="hidden dark:inline-flex" />

            <h2 className="mt-6 text-2xl font-semibold leading-tight tracking-tight text-slate-900 dark:text-white">
              Welcome Back
              <br />
              to{" "}
              <span className="bg-gradient-to-r from-blue-600 to-teal-500 bg-clip-text text-transparent dark:from-blue-400 dark:to-teal-300">
                Atlas Web Insight
              </span>
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Sign in with your Atlas Google account to continue to the dashboard.
            </p>

            {errorMessage && (
              <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {errorMessage}
              </div>
            )}

            <form action={googleSignInAction} className="mt-6">
              <input type="hidden" name="next" value={nextValue} />
              <GoogleSignInButton />
            </form>

            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
              <span className="text-xs text-slate-400">or</span>
              <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
            </div>

            {/* Secure access notice */}
            <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-4 dark:bg-blue-500/10">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Secure Access</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Only approved Atlas accounts can access this application.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
