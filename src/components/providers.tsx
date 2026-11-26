"use client";

import { ThemeProvider } from "next-themes";
import { ToastProvider } from "@/components/ui/toast";
import { ChunkReloadRecovery } from "@/components/shell/chunk-reload";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {/* Auto-recovers navigation that fails on stale chunks after a deploy. */}
      <ChunkReloadRecovery />
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  );
}
