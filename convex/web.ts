import { ConvexError } from "convex/values";

// The two Firecrawl calls the product makes: a web search that also returns each
// result's readable text, and a single-page read. Everything the model is later
// asked about comes from what these return, so the model is never the source.

export type WebPage = { url: string; title: string; markdown: string };

const MAX_PAGE = 40_000;

// `wholePage` keeps headers and footers, which is where a company's contact
// address usually is; a travel guide only needs its main text.
export async function searchWithContent(
  key: string,
  query: string,
  limit = 5,
  wholePage = false,
): Promise<WebPage[]> {
  let response: Response;
  try {
    response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        sources: [{ type: "web" }],
        limit,
        timeout: 45_000,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: !wholePage },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ConvexError("The web search could not connect. Please try again.");
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 180);
    throw new ConvexError(
      `The web search was refused (status ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return readSearch(await response.json());
}

export async function readPage(key: string, url: string): Promise<WebPage | null> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: false, timeout: 30_000 }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { markdown?: unknown; metadata?: { title?: unknown } } };
    const markdown = typeof body.data?.markdown === "string" ? body.data.markdown : "";
    if (!markdown) return null;
    const title = typeof body.data?.metadata?.title === "string" ? body.data.metadata.title : url;
    return { url, title: title.slice(0, 300), markdown: markdown.slice(0, MAX_PAGE) };
  } catch {
    return null;
  }
}

// Only https pages with a real host and no embedded credentials are kept: each is
// shown to a person as a link.
export function readSearch(body: unknown): WebPage[] {
  const data =
    body && typeof body === "object" && "data" in body ? (body).data : null;
  const web =
    data && typeof data === "object" && "web" in data ? (data).web : null;
  if (!Array.isArray(web)) throw new ConvexError("The web search returned an unexpected response.");
  const pages: WebPage[] = [];
  const seen = new Set<string>();
  for (const raw of web) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.url !== "string") continue;
    let url: URL;
    try { url = new URL(item.url); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || seen.has(url.href)) continue;
    seen.add(url.href);
    const markdown = typeof item.markdown === "string" ? item.markdown : typeof item.description === "string" ? item.description : "";
    pages.push({
      url: url.href,
      title: typeof item.title === "string" ? item.title.slice(0, 300) : url.hostname,
      markdown: markdown.slice(0, MAX_PAGE),
    });
  }
  return pages;
}

export const domainOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};

// Directories, marketplaces, review sites and social networks list operators but
// are not operators. A result from one of these is never treated as a company.
const NOT_AN_OPERATOR = [
  "tripadvisor.", "viator.", "getyourguide.", "booking.", "expedia.", "wikipedia.",
  "reddit.", "facebook.", "instagram.", "youtube.", "linkedin.", "twitter.", "x.com",
  "lonelyplanet.", "tourradar.", "klook.", "agoda.", "airbnb.", "trustpilot.",
  "yelp.", "pinterest.", "tiktok.", "quora.", "medium.com", "bookretreats.",
  "retreat.guru", "responsibletravel.", "intrepidtravel.", "gadventures.",
  "timeout.", "cntraveler.", "travelandleisure.", "nationalgeographic.",
];

export const looksLikeDirectory = (domain: string) =>
  !domain || NOT_AN_OPERATOR.some((part) => domain.includes(part));

// Every address on a page, lowercased. An address is only ever stored when it was
// found on the operator's own pages; a model is never trusted to supply one.
export function emailsIn(text: string): string[] {
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(found.map((item) => item.toLowerCase()))].filter(
    (item) =>
      !/\.(png|jpe?g|gif|webp|svg)$/.test(item) &&
      !/example\.|sentry|wixpress|domain\.com|email\.com|yourname|@2x/.test(item),
  );
}

// Prefer an address on the operator's own domain, then a bookings-style one.
export function bestEmail(candidates: string[], domain: string): string {
  const own = candidates.filter((item) => item.split("@")[1]?.endsWith(domain));
  const pool = own.length ? own : candidates;
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  return ranked[0] ?? "";
  function score(address: string) {
    const local = address.split("@")[0];
    return /^(sales|reservations?|bookings?|groups?|info|contact|enquir|inquir|hello)/.test(local) ? 2 : 1;
  }
}
