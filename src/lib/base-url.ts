/**
 * The app's public base URL (scheme + host, no trailing slash).
 *
 * Behind a reverse proxy the incoming request host is an internal one (e.g.
 * localhost:9091), so redirects built from `new URL(request.url).origin` send
 * the browser somewhere unreachable (ERR_CONNECTION_REFUSED). Resolution order:
 *   1. the explicitly configured public URL — APP_URL, then AUTH_URL, then
 *      NEXTAUTH_URL (the right choice for local, UAT and production);
 *   2. the reverse proxy's forwarded host/proto headers, so a deployed user is
 *      never sent to the internal origin even if the env var was forgotten;
 *   3. the request's own origin (local dev without a proxy).
 * No environment-specific URL is hardcoded.
 */
export function baseUrl(request: Request): string {
  const configured = (process.env.APP_URL ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL)?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  // Reverse-proxy forwarded headers (first value if a comma-separated list).
  const fwdHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwdHost) {
    const fwdProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${fwdProto}://${fwdHost}`;
  }

  return new URL(request.url).origin;
}
