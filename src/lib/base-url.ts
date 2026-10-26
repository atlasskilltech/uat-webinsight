/**
 * The app's public base URL (scheme + host, no trailing slash).
 *
 * Behind a reverse proxy the incoming request host can be an internal one
 * (e.g. localhost:9091), so redirects built from `new URL(request.url).origin`
 * would send the browser somewhere unreachable. Prefer the configured public
 * URL (APP_URL, then AUTH_URL) and fall back to the request origin only when
 * neither is set.
 */
export function baseUrl(request: Request): string {
  const configured = (process.env.APP_URL ?? process.env.AUTH_URL)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}
