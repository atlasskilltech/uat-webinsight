/**
 * Dependency-free, allow-list HTML sanitizer for UNTRUSTED email bodies that we
 * inline into a forwarded message. It is a small tokenizer (NOT a regex pass, so
 * nested-tag bypasses like `<scr<script>ipt>` are handled): it walks the input,
 * drops dangerous tags with their content (script/style/iframe/…), UNWRAPS
 * unknown tags (keeping their text), and for allowed tags keeps only safe
 * attributes with safe URL schemes and a safe inline-style subset. It never
 * executes anything and strips every event handler and javascript:/vbscript:
 * URL. The forwarded HTML is also rendered by Gmail/Outlook, which sanitize
 * again — this is defense in depth, not the only layer.
 *
 * It is NOT a general-purpose sanitizer for browser-injected DOM; it targets the
 * email-HTML subset and errs on the side of removing anything it doesn't
 * recognize.
 */

const ALLOWED_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "mark", "small", "big", "sub", "sup",
  "p", "div", "span", "br", "hr", "blockquote", "pre", "code", "abbr", "cite", "q",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "col", "colgroup",
  "img", "font", "center", "figure", "figcaption",
  "section", "article", "header", "footer", "main", "aside", "nav", "address",
]);

// Dangerous tags: drop the tag AND everything up to its matching close tag.
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "svg", "math", "noscript", "template",
  "form", "link", "meta", "base", "title", "head", "html", "body", "applet", "frame",
  "frameset", "canvas", "audio", "video", "source", "track",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

// Attributes kept on any allowed tag (presentation only — never event handlers).
const GLOBAL_ATTRS = new Set([
  "style", "align", "valign", "dir", "title", "lang", "width", "height", "bgcolor",
  "color", "cellpadding", "cellspacing", "border", "colspan", "rowspan", "nowrap",
  "span", "face", "size",
]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set([...GLOBAL_ATTRS, "href", "target", "rel", "name"]),
  img: new Set([...GLOBAL_ATTRS, "src", "alt"]),
};

// Safe inline-style properties (reject url(), expression(), anything else).
const ALLOWED_STYLE_PROPS = new Set([
  "color", "background-color", "font", "font-family", "font-size", "font-weight",
  "font-style", "text-align", "text-decoration", "text-transform", "line-height",
  "letter-spacing", "vertical-align", "white-space", "display", "width", "height",
  "max-width", "min-width", "padding", "padding-top", "padding-right", "padding-bottom",
  "padding-left", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-color",
  "border-width", "border-style", "border-radius", "border-collapse", "border-spacing",
]);

function attrEscape(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const NAMED_ENTITIES: Record<string, string> = {
  tab: "\t", newline: "\n", colon: ":", semi: ";", sol: "/", lpar: "(", rpar: ")",
  lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " ",
};
function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Decode HTML character references the way an email client would BEFORE we
 * validate a URL or CSS value, so entity-encoded payloads (e.g.
 * `javascript&#58;`, `e&#x78;pression`, `color:red&#59;position:fixed`) cannot
 * slip a dangerous scheme/property past the checks. It intentionally decodes at
 * least as aggressively as a client (numeric refs with or without the trailing
 * `;`), so validation fails closed.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

// Raster image data: URIs only — SVG (which can carry script/external refs) and
// any non-image data: are rejected.
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)[;,]/i;

function safeUrl(raw: string, allowData: boolean): string | null {
  // Decode entities + strip control/whitespace used to smuggle a scheme, then
  // validate. Returning the DECODED value means the emitted URL is the real one
  // (re-escaped by the caller), not an entity form that re-decodes to something
  // dangerous in the recipient's client.
  const v = decodeEntities(raw).replace(/[\u0000-\u0020\u007f]/g, "");
  // Backslashes never legitimately appear in a scheme; strip them so a value
  // like `java\script:` can't reach the recipient's client as a live scheme.
  const u = v.replace(/\\/g, "");
  if (u === "") return null;
  if (/^(#|\/|\.{1,2}\/)/.test(u)) return u; // relative / anchor / protocol-relative
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  if (!scheme) return u; // no scheme → relative/plain
  const s = scheme[1].toLowerCase();
  if (s === "http" || s === "https" || s === "mailto" || s === "tel") return u;
  if (allowData && s === "data") return DATA_IMAGE_RE.test(u) ? u : null; // raster data:image only
  return null; // javascript:, vbscript:, data:text/html, data:image/svg+xml, file:, etc.
}

function sanitizeStyle(raw: string): string {
  // Decode entities FIRST, before splitting on ';', so an encoded semicolon
  // (`&#59;`) can't smuggle a disallowed declaration, and an encoded
  // `expression`/`url` can't evade the substring checks.
  const decoded = decodeEntities(raw);
  const out: string[] = [];
  for (const decl of decoded.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    // Strip quotes + backslashes BEFORE checking, so a CSS escape like
    // `ex\pression(...)` cannot reconstruct a dangerous keyword in the output.
    const value = decl.slice(idx + 1).trim().replace(/["\\]/g, "");
    const lv = value.toLowerCase();
    if (lv.includes("url(") || lv.includes("expression") || lv.includes("javascript:") || lv.includes("vbscript:") || lv.includes("behavior") || lv.includes("<") || lv.includes(">")) continue;
    out.push(`${prop}:${value}`);
  }
  return out.join(";");
}

interface ParsedAttr {
  name: string;
  value: string;
}

/** Parse attributes from the inside of a start tag (name may be followed by attrs). */
function parseAttrs(s: string): ParsedAttr[] {
  const attrs: ParsedAttr[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /[\s/]/.test(s[i])) i++;
    if (i >= n) break;
    let name = "";
    while (i < n && /[^\s=/>]/.test(s[i])) name += s[i++];
    if (!name) { i++; continue; }
    while (i < n && /\s/.test(s[i])) i++;
    let value = "";
    if (s[i] === "=") {
      i++;
      while (i < n && /\s/.test(s[i])) i++;
      const q = s[i];
      if (q === '"' || q === "'") {
        i++;
        while (i < n && s[i] !== q) value += s[i++];
        i++; // closing quote
      } else {
        while (i < n && /[^\s>]/.test(s[i])) value += s[i++];
      }
    }
    attrs.push({ name: name.toLowerCase(), value });
  }
  return attrs;
}

export interface SanitizeOptions {
  /** Resolve a cid: reference (without the "cid:" prefix) to a data: URI, or
   *  null to drop the image. Inline images are handled here. */
  resolveCid?: (cid: string) => string | null;
  /** Hard cap on output length; longer input is truncated with a notice. */
  maxLength?: number;
}

/** Sanitize an untrusted HTML fragment for safe inlining into our forward. */
export function sanitizeEmailHtml(html: string, opts: SanitizeOptions = {}): string {
  const resolveCid = opts.resolveCid;
  const maxLength = opts.maxLength ?? 500_000;
  let out = "";
  let i = 0;
  const n = html.length;

  const emitText = (t: string) => {
    // Text between tags is kept, but a lone '<' that didn't start a tag is escaped.
    out += t.replace(/</g, "&lt;");
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { emitText(html.slice(i)); break; }
    if (lt > i) emitText(html.slice(i, lt));
    i = lt;

    // Comments / declarations / CDATA → drop entirely.
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i);
      i = end < 0 ? n : end + 1;
      continue;
    }

    const isClose = html[i + 1] === "/";
    const nameStart = i + (isClose ? 2 : 1);
    // A '<' not followed by a tag-name letter is literal text.
    if (!/[a-zA-Z]/.test(html[nameStart] || "")) { emitText("<"); i++; continue; }
    let j = nameStart;
    let name = "";
    while (j < n && /[a-zA-Z0-9]/.test(html[j])) name += html[j++];
    name = name.toLowerCase();

    // Find the end of the tag, respecting quotes so a quoted '>' doesn't end it.
    let k = j;
    let quote = "";
    while (k < n) {
      const c = html[k];
      if (quote) { if (c === quote) quote = ""; k++; continue; }
      if (c === '"' || c === "'") { quote = c; k++; continue; }
      if (c === ">") break;
      if (c === "<") break; // malformed: new tag starts → stop here
      k++;
    }
    const inner = html.slice(j, k); // attributes text
    const tagEnd = html[k] === ">" ? k + 1 : k; // if stopped on '<', reprocess from there

    if (isClose) {
      if (ALLOWED_TAGS.has(name)) out += `</${name}>`;
      i = tagEnd;
      continue;
    }

    if (DROP_WITH_CONTENT.has(name)) {
      // Skip everything up to the matching close tag (case-insensitive).
      const closeRe = new RegExp(`</${name}\\s*>`, "i");
      const rest = html.slice(tagEnd);
      const m = closeRe.exec(rest);
      i = m ? tagEnd + m.index + m[0].length : n;
      continue;
    }

    if (!ALLOWED_TAGS.has(name)) {
      // Unknown/disallowed but not dangerous → UNWRAP (drop the tag, keep content).
      i = tagEnd;
      continue;
    }

    // Allowed tag: rebuild with filtered attributes.
    const allowed = TAG_ATTRS[name] ?? GLOBAL_ATTRS;
    const selfClose = inner.trimEnd().endsWith("/") || VOID_TAGS.has(name);
    const kept: string[] = [];
    for (const a of parseAttrs(inner)) {
      if (a.name.startsWith("on")) continue; // never event handlers
      if (!allowed.has(a.name)) continue;
      if (a.name === "href") {
        const u = safeUrl(a.value, false);
        if (!u) continue;
        kept.push(`href="${attrEscape(u)}"`);
      } else if (a.name === "src") {
        let v = a.value.trim();
        const cid = /^cid:(.+)$/i.exec(v);
        if (cid) {
          const resolved = resolveCid?.(cid[1].trim());
          if (!resolved) continue; // drop inline image we can't safely embed
          v = resolved;
        }
        const u = safeUrl(v, true);
        if (!u) continue;
        kept.push(`src="${attrEscape(u)}"`);
      } else if (a.name === "style") {
        const st = sanitizeStyle(a.value);
        if (st) kept.push(`style="${attrEscape(st)}"`);
      } else {
        kept.push(`${a.name}="${attrEscape(a.value)}"`);
      }
    }
    // An <img> with no usable src (e.g. an unresolved cid: inline image) is
    // dropped entirely rather than left as an empty broken image.
    if (name === "img" && !kept.some((a) => a.startsWith("src="))) {
      i = tagEnd;
      continue;
    }
    if (name === "a") kept.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
    out += `<${name}${kept.length ? " " + kept.join(" ") : ""}${selfClose ? " /" : ""}>`;
    i = tagEnd;

    if (out.length > maxLength) {
      out = out.slice(0, maxLength) + "<p><em>[original message truncated — see original.eml for the full content]</em></p>";
      break;
    }
  }
  return out;
}
