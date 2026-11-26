/**
 * SVAP §6 custom vocabulary + §9 pronunciation lexicon — Web Insight Agent.
 *
 * SVAP requires proper nouns and domain terms to be injectable per agent, and
 * the list to be DATA-DRIVEN, not hard-coded (§6). The browser-native Web Speech
 * API has no vocabulary-biasing hook, so this is **seeded now and consumed when a
 * streaming-STT backend with a phrase-list / biasing API is available** — see
 * `docs/SVAP-CONFORMANCE.md`. Until then it still powers the TTS lexicon (§9).
 *
 * Plain constants (no "server-only"): the static seed is shared by client and
 * server; `buildCustomVocabulary` merges in dynamic names (orgs, people,
 * programmes) that only the server can read, so the caller passes them in.
 */

export interface VocabGroup {
  /** What this group covers — for the admin UI / docs, not sent to the STT. */
  label: string;
  terms: string[];
}

/**
 * The curated static seed, grouped for readability. Everything here is a term
 * the STT should be biased toward and the TTS should pronounce correctly.
 */
export const VOCAB_SEED: VocabGroup[] = [
  {
    label: "Brand & products",
    terms: [
      "ATLAS",
      "Atlas University",
      "Atlas SkillTech University",
      "atlasuniversity.edu.in",
      "WebInsight",
      "Web Insight",
      "Web Insight Agent",
      "IntelligenceOS",
      "upGrad",
      "Aila",
      "Uni-AI",
    ],
  },
  {
    label: "Modules & pages",
    terms: [
      "Executive Dashboard",
      "My Work",
      "SEO & Analytics",
      "Page Inspector",
      "Technical SEO Issues",
      "Backend & Server",
      "Operations",
      "Competitor Intelligence",
      "Reports & History",
      "Invoice Agent",
      "Connected inboxes",
      "Settings & Integrations",
      "Agent API",
      "User Management",
    ],
  },
  {
    label: "SEO & analytics terms",
    terms: [
      "SEO", "SERP", "backlink", "backlinks", "canonical", "canonical tag",
      "metadata", "meta title", "meta description", "sitemap", "robots.txt",
      "crawl", "crawlability", "indexing", "deindex", "keyword", "keywords",
      "Core Web Vitals", "LCP", "CLS", "INP", "structured data", "schema markup",
      "alt text", "anchor text", "redirect", "301 redirect", "404", "hreflang",
      "domain authority", "organic traffic", "impressions", "click-through rate",
      "CTR", "bounce rate", "page speed",
    ],
  },
  {
    label: "Invoice & finance terms",
    terms: [
      "invoice", "GSTIN", "GST", "PO", "purchase order", "vendor", "party",
      "line item", "TDS", "due date", "overdue", "remittance", "payable",
      "tax invoice", "credit note",
    ],
  },
  {
    label: "Actions & roles",
    terms: [
      "audit", "page audit", "work log", "task", "issue register",
      "counsellor", "student", "admin", "invoice-only",
    ],
  },
];

/** Flat, de-duplicated static seed. */
export const CUSTOM_VOCABULARY_SEED: string[] = dedupe(VOCAB_SEED.flatMap((g) => g.terms));

/**
 * §9 pronunciation lexicon: term → how the TTS should say it. Only entries that
 * a default voice gets wrong need listing; everything else reads fine as-is.
 * Values are spelled-out / respelled forms (a stand-in for a real SSML lexicon).
 */
export const TTS_LEXICON: Record<string, string> = {
  ATLAS: "Atlas",
  IntelligenceOS: "Intelligence O S",
  upGrad: "up-grad",
  "Uni-AI": "Uni A I",
  WebInsight: "Web Insight",
  SEO: "S E O",
  SERP: "surp",
  CTR: "C T R",
  LCP: "L C P",
  CLS: "C L S",
  INP: "I N P",
  GSTIN: "G S T I N",
  GST: "G S T",
  TDS: "T D S",
  PO: "P O",
  hreflang: "H ref lang",
  "robots.txt": "robots dot t x t",
  "atlasuniversity.edu.in": "atlas university dot e d u dot i n",
  "301 redirect": "three oh one redirect",
  "404": "four oh four",
};

/**
 * Build the agent's custom-vocabulary phrase list: the static seed plus any
 * dynamic proper nouns the server can supply at request time (org / party
 * names, people, programme names). This is the injectable, data-driven list a
 * streaming STT biases toward. Pass nothing for the static-only list.
 */
export function buildCustomVocabulary(dynamic?: {
  orgNames?: string[];
  people?: string[];
  programmes?: string[];
}): string[] {
  return dedupe([
    ...CUSTOM_VOCABULARY_SEED,
    ...(dynamic?.orgNames ?? []),
    ...(dynamic?.people ?? []),
    ...(dynamic?.programmes ?? []),
  ]);
}

/** Apply the TTS lexicon to a line of text before it is spoken (§9). */
export function applyTtsLexicon(text: string): string {
  let out = text;
  for (const [term, say] of Object.entries(TTS_LEXICON)) {
    // whole-word, case-insensitive; escape regex-significant chars in the term
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\w-])${safe}(?![\\w-])`, "gi"), say);
  }
  return out;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
