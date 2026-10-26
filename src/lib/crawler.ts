import "server-only";

export interface CrawlResult {
  ok: boolean;
  error?: string;
  finalUrl?: string;
  httpStatus?: number;
  redirected?: boolean;
  title?: string;
  titleLength?: number;
  metaDescription?: string;
  metaDescLength?: number;
  robots?: string;
  canonical?: string;
  h1?: string;
  headingStructure?: { level: number; text: string }[];
  imagesTotal?: number;
  imagesMissingAlt?: number;
  internalLinks?: number;
  externalLinks?: number;
  structuredData?: string[];
  wordCount?: number;
  indexable?: "indexable" | "blocked" | "unknown";
}

const UA =
  "Mozilla/5.0 (compatible; AtlasDashboardAuditBot/1.0; +https://atlasuniversity.edu.in)";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return m ? m[1] : undefined;
}

/**
 * Fetch a public page and extract on-page SEO signals. Uses only the standard
 * fetch + lightweight parsing (no headless browser). Respects a timeout and
 * never throws — failures are returned as { ok:false, error }.
 */
export async function crawlPage(url: string): Promise<CrawlResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  let res: Response;
  try {
    res = await fetch(target.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "TimeoutError"
          ? "The page took too long to respond (timeout)."
          : "Could not reach the page. It may be blocking automated requests or be unavailable from this server.",
    };
  }

  const httpStatus = res.status;
  const finalUrl = res.url;
  const redirected = res.redirected;
  const contentType = res.headers.get("content-type") ?? "";
  const headerRobots = res.headers.get("x-robots-tag") ?? undefined;

  if (!contentType.includes("text/html")) {
    return {
      ok: true,
      httpStatus,
      finalUrl,
      redirected,
      error: `Response is not HTML (${contentType || "unknown"}).`,
      indexable: "unknown",
    };
  }

  const html = await res.text();

  // Strip script/style for text extraction.
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]) : undefined;

  // Meta tags
  let metaDescription: string | undefined;
  let robots = headerRobots;
  let canonical: string | undefined;
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const name = attr(tag, "name")?.toLowerCase();
    if (name === "description") metaDescription = decodeEntities(attr(tag, "content") ?? "");
    if (name === "robots") robots = attr(tag, "content") ?? robots;
  }
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if (attr(tag, "rel")?.toLowerCase() === "canonical") canonical = attr(tag, "href");
  }

  // Headings
  const headingStructure: { level: number; text: string }[] = [];
  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(noScript)) && headingStructure.length < 60) {
    const text = decodeEntities(hm[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (text) headingStructure.push({ level: Number(hm[1]), text });
  }
  const h1 = headingStructure.find((h) => h.level === 1)?.text;

  // Images
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesTotal = imgTags.length;
  const imagesMissingAlt = imgTags.filter((t) => {
    const alt = attr(t, "alt");
    return alt === undefined || alt.trim() === "";
  }).length;

  // Links
  let internalLinks = 0;
  let externalLinks = 0;
  const anchorTags = html.match(/<a\b[^>]*href\s*=\s*["'][^"']*["'][^>]*>/gi) ?? [];
  for (const tag of anchorTags) {
    const href = attr(tag, "href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    try {
      const u = new URL(href, finalUrl);
      if (u.host === target.host) internalLinks++;
      else externalLinks++;
    } catch {
      /* ignore malformed */
    }
  }

  // Structured data
  const structuredData: string[] = [];
  const ldRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = ldRe.exec(html))) {
    try {
      const json = JSON.parse(lm[1].trim());
      const collect = (obj: unknown) => {
        if (Array.isArray(obj)) obj.forEach(collect);
        else if (obj && typeof obj === "object") {
          const t = (obj as Record<string, unknown>)["@type"];
          if (typeof t === "string") structuredData.push(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && structuredData.push(x));
          const graph = (obj as Record<string, unknown>)["@graph"];
          if (graph) collect(graph);
        }
      };
      collect(json);
    } catch {
      /* ignore invalid JSON-LD */
    }
  }

  // Word count (body text)
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(noScript);
  const bodyText = (bodyMatch ? bodyMatch[1] : noScript).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  const noindex = /noindex/i.test(robots ?? "");
  const indexable: CrawlResult["indexable"] =
    httpStatus >= 200 && httpStatus < 300 && !noindex ? "indexable" : "blocked";

  return {
    ok: true,
    finalUrl,
    httpStatus,
    redirected,
    title,
    titleLength: title?.length,
    metaDescription: metaDescription || undefined,
    metaDescLength: metaDescription?.length ?? 0,
    robots,
    canonical,
    h1,
    headingStructure,
    imagesTotal,
    imagesMissingAlt,
    internalLinks,
    externalLinks,
    structuredData: [...new Set(structuredData)],
    wordCount,
    indexable,
  };
}
