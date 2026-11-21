import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for the Invoice Agent unit tests. Tests target PURE logic
 * (money/GST engine, encryption, upload validation, Zod schemas, formatting).
 * `server-only` is aliased to a no-op so those modules import under Node, and
 * the DB pool is never created because tests never call query helpers.
 */
export default defineConfig({
  // Inline (empty) PostCSS config so Vitest never loads the app's Tailwind
  // PostCSS plugin, which it cannot process.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "server-only": path.resolve(process.cwd(), "test/stubs/server-only.ts"),
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    environment: "node",
    css: false,
    include: ["test/**/*.test.ts"],
    env: {
      // Deterministic 32-byte key (base64) for crypto round-trip tests.
      INVOICE_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    },
  },
});
