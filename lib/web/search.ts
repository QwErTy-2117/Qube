/**
 * Credential-free web search with bounded, parallel providers.
 *
 * The previous implementation called DuckDuckGo's HTML endpoint with a 10s
 * timeout and only fell back to a second DuckDuckGo backend *after a
 * successful response with no links*. When the endpoint was unreachable
 * (it is blocked on some networks and frequently stalls), the whole tool
 * failed after the timeout and the fallback never ran.
 *
 * This module races independent providers (DuckDuckGo HTML/Lite and Bing's
 * RSS endpoint) with a short per-provider timeout, so a blocked or slow
 * provider cannot consume the whole search budget. Parsing is deliberately
 * dependency-free: no logger writes files next to the app and no HTML parser
 * is bundled into the agent path.
 */

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchProviderName = "duckduckgo-html" | "duckduckgo-lite" | "bing-rss";

export type WebSearchOutcome = {
  query: string;
  results: WebSearchResult[];
  provider?: WebSearchProviderName;
  errors: string[];
};

export type WebSearchOptions = {
  /** Per-provider request timeout. The first useful provider wins. */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Restrict/override providers (tests and diagnostics). */
  providers?: WebSearchProviderName[];
};

const DEFAULT_TIMEOUT_MS = 7_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_TITLE_CHARS = 300;
const MAX_SNIPPET_CHARS = 400;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeHtmlEntities(value: string): string {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
    })
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _match;
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function stripMarkup(value: string): string {
  // RSS descriptions often contain entity-escaped markup (`&lt;b&gt;`).
  // Decode first, strip the resulting tags, then decode once more for entities
  // that were hidden inside those tags.
  const decoded = decodeHtmlEntities(
    String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"),
  );
  return decodeHtmlEntities(decoded.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function cleanTitle(value: string): string {
  return stripMarkup(value).slice(0, MAX_TITLE_CHARS);
}

function cleanSnippet(value: string): string {
  return stripMarkup(value).slice(0, MAX_SNIPPET_CHARS);
}

function dedupe(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const result of results) {
    if (!result.url || seen.has(result.url)) continue;
    seen.add(result.url);
    out.push(result);
  }
  return out;
}

/** DuckDuckGo wraps result links in `/l/?uddg=<encoded original>`. */
function unwrapDuckDuckGoUrl(href: string): string | null {
  let value = decodeHtmlEntities(href).trim();
  if (!value) return null;
  if (value.startsWith("//")) value = `https:${value}`;
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    if (target) value = decodeURIComponent(target);
  } catch {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (/(^|\.)duckduckgo\.com$/i.test(parsed.hostname) && /^\/y\.js$/i.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Parse the full DuckDuckGo HTML results page. */
export function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks = String(html || "").split(/<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>/i).slice(1);
  for (const block of blocks) {
    if (results.length >= limit) break;
    const anchor =
      /<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
      /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = unwrapDuckDuckGoUrl(anchor[1]);
    const title = cleanTitle(anchor[2]);
    if (!url || !title) continue;
    const snippetMatch =
      /<a\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
      /<div\b[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block) ||
      /<td\b[^>]*class="[^"]*\bresult-snippet\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(block);
    results.push({
      title,
      url,
      snippet: snippetMatch ? cleanSnippet(snippetMatch[1]) : "",
    });
  }
  return dedupe(results).slice(0, limit);
}

/** Parse the lighter DuckDuckGo table layout. */
export function parseDuckDuckGoLite(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const anchorRe = /<a\b(?=[^>]*class="[^"]*\bresult-link\b[^"]*")[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td\b[^>]*class="[^"]*\bresult-snippet\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;
  const snippets: string[] = [];
  let snippet: RegExpExecArray | null;
  while ((snippet = snippetRe.exec(html))) snippets.push(cleanSnippet(snippet[1]));
  let anchor: RegExpExecArray | null;
  while ((anchor = anchorRe.exec(html)) && results.length < limit) {
    const url = unwrapDuckDuckGoUrl(anchor[1]);
    const title = cleanTitle(anchor[2]);
    if (!url || !title) continue;
    results.push({ title, url, snippet: snippets[results.length] || "" });
  }
  return dedupe(results).slice(0, limit);
}

/** Parse Bing's `&format=rss` response (fast, no JavaScript, no API key). */
export function parseBingRss(xml: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let item: RegExpExecArray | null;
  while ((item = itemRe.exec(xml)) && results.length < limit) {
    const body = item[1];
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(body);
    const linkMatch = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(body);
    const descriptionMatch = /<description\b[^>]*>([\s\S]*?)<\/description>/i.exec(body);
    const title = cleanTitle(titleMatch?.[1] || "");
    const url = decodeHtmlEntities(linkMatch?.[1] || "").trim();
    if (!title || !url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    } catch {
      continue;
    }
    results.push({
      title,
      url,
      snippet: descriptionMatch ? cleanSnippet(descriptionMatch[1]) : "",
    });
  }
  return dedupe(results).slice(0, limit);
}

type Provider = {
  name: WebSearchProviderName;
  url: (query: string) => string;
  parse: (body: string, limit: number) => WebSearchResult[];
};

const PROVIDERS: Record<WebSearchProviderName, Provider> = {
  "duckduckgo-html": {
    name: "duckduckgo-html",
    url: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGoHtml,
  },
  "duckduckgo-lite": {
    name: "duckduckgo-lite",
    url: (query) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGoLite,
  },
  "bing-rss": {
    name: "bing-rss",
    url: (query) =>
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=10`,
    parse: parseBingRss,
  },
};

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 6;
  return Math.min(10, Math.max(1, Math.floor(Number(value))));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchProvider(
  provider: Provider,
  query: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  limit: number,
): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("search provider timed out")), timeoutMs);
  try {
    const response = await fetchImpl(provider.url(query), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    const results = provider.parse(body, limit);
    if (results.length === 0) throw new Error("no results parsed");
    return results;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search the web. Providers run in parallel; the first non-empty result wins,
 * and a blocked/stalled provider cannot exceed the per-provider timeout.
 * Never throws: a failed search returns `results: []` plus the diagnostics.
 */
export async function searchWeb(
  query: string,
  maxResults?: number,
  options: WebSearchOptions = {},
): Promise<WebSearchOutcome> {
  const cleanQuery = String(query || "").trim().slice(0, 500);
  const limit = clampLimit(maxResults);
  const errors: string[] = [];
  if (!cleanQuery) return { query: cleanQuery, results: [], errors: ["empty query"] };

  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(500, Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS),
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { query: cleanQuery, results: [], errors: ["fetch is not available"] };
  }
  const names = options.providers?.length
    ? options.providers.filter((name) => PROVIDERS[name])
    : (["duckduckgo-html", "bing-rss"] as WebSearchProviderName[]);

  const attempts = names.map(async (name) => {
    const provider = PROVIDERS[name];
    try {
      const results = await fetchProvider(provider, cleanQuery, timeoutMs, fetchImpl, limit);
      return { provider: provider.name, results };
    } catch (error) {
      const message = errorMessage(error);
      errors.push(`${provider.name}: ${message}`);
      throw new Error(`${provider.name}: ${message}`);
    }
  });

  try {
    const winner = await Promise.any(attempts);
    return {
      query: cleanQuery,
      results: winner.results.slice(0, limit),
      provider: winner.provider,
      errors,
    };
  } catch {
    return { query: cleanQuery, results: [], errors: errors.length ? errors : ["all search providers failed"] };
  }
}
