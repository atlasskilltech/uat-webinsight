// Plain-language explanations of metrics, surfaced in tooltips so a
// non-technical manager can understand every figure on screen.

export const GLOSSARY: Record<string, string> = {
  clicks:
    "Search clicks: how many times people clicked through to the site from Google Search results.",
  impressions:
    "Impressions: how many times a page appeared in Google Search results, whether or not it was clicked.",
  ctr: "Click-through rate (CTR): clicks ÷ impressions. Of the people who saw the page in search results, the share who clicked.",
  position:
    "Average position: the average ranking of the page in Google Search results (1 is the top). Lower is better.",
  views:
    "Views (GA4): the number of times pages were loaded, including repeat views by the same person.",
  activeUsers:
    "Active users (GA4): the number of distinct people who engaged with the site in the period.",
  sessions:
    "Sessions (GA4): a group of interactions by one user within a time window. One user can have several sessions.",
  engagementRate:
    "Engagement rate (GA4): the share of sessions that were 'engaged' (lasted 10s+, had a conversion, or 2+ page views).",
  engagementTime:
    "Average engagement time: how long, on average, the site was in focus during a session.",
  indexing:
    "Indexing: whether Google has stored the page in its index so it can appear in search. A page can return HTTP 200 and still not be indexed.",
  coreWebVitals:
    "Core Web Vitals: Google's page-experience metrics — LCP (loading), CLS (visual stability) and INP (responsiveness).",
  lcp: "Largest Contentful Paint (LCP): time until the largest element is visible. Good ≤ 2.5s.",
  cls: "Cumulative Layout Shift (CLS): how much the layout unexpectedly moves. Good ≤ 0.1.",
  inp: "Interaction to Next Paint (INP): responsiveness to user input. Good ≤ 200ms.",
  canonical:
    "Canonical URL: the single preferred version of a page. It tells search engines which URL to index when similar pages exist.",
  robots:
    "Robots directives: instructions (in a meta tag or header) telling search engines whether they may index or follow a page.",
  structuredData:
    "Structured data (schema.org): machine-readable markup that helps search engines understand the page and can enable rich results.",
  gsc: "Google Search Console measures how the site performs in Google Search (clicks, impressions, position).",
  ga4: "Google Analytics 4 measures on-site behaviour (users, sessions, views, engagement).",
};

export function explain(key: keyof typeof GLOSSARY | string): string {
  return GLOSSARY[key] ?? "";
}
