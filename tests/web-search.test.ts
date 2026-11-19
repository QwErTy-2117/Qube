import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseBingRss,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  searchWeb,
} from "@/lib/web/search";

const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <div class="result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1">Example <b>Docs</b></a>
    </h2>
    <a class="result__snippet" href="https://example.com/docs">A useful &amp; authoritative page.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <h2><a class="result__a" href="https://example.org/page">Second result</a></h2>
  <div class="result__snippet">Another summary &#8212; with entities.</div>
</div>
`;

const DDG_LITE = `
<table>
  <tr><td><a rel="nofollow" href="https://example.net/lite" class="result-link">Lite result</a></td></tr>
  <tr><td class="result-snippet">Lite snippet.</td></tr>
</table>
`;

const BING_RSS = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0"><channel>
  <item>
    <title>Bing &amp; result</title>
    <link>https://example.com/bing</link>
    <description>Fast fallback &lt;b&gt;summary&lt;/b&gt;.</description>
  </item>
  <item>
    <title><![CDATA[Second Bing]]></title>
    <link>https://example.org/bing-2</link>
    <description><![CDATA[Second description]]></description>
  </item>
</channel></rss>`;

describe("web search parsing", () => {
  it("parses DuckDuckGo HTML results, snippets, redirects and entities", () => {
    const results = parseDuckDuckGoHtml(DDG_HTML, 10);
    assert.equal(results.length, 2);
    assert.equal(results[0].title, "Example Docs");
    assert.equal(results[0].url, "https://example.com/docs?a=1");
    assert.equal(results[0].snippet, "A useful & authoritative page.");
    assert.equal(results[1].url, "https://example.org/page");
    assert.match(results[1].snippet, /Another summary/);
  });

  it("parses DuckDuckGo Lite results", () => {
    const results = parseDuckDuckGoLite(DDG_LITE, 10);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Lite result");
    assert.equal(results[0].url, "https://example.net/lite");
    assert.equal(results[0].snippet, "Lite snippet.");
  });

  it("parses Bing RSS results and CDATA", () => {
    const results = parseBingRss(BING_RSS, 10);
    assert.equal(results.length, 2);
    assert.equal(results[0].title, "Bing & result");
    assert.equal(results[0].url, "https://example.com/bing");
    assert.equal(results[0].snippet, "Fast fallback summary.");
    assert.equal(results[1].title, "Second Bing");
    assert.equal(results[1].url, "https://example.org/bing-2");
  });
});

describe("web search providers", () => {
  it("falls back to a fast provider when DuckDuckGo stalls", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("duckduckgo.com")) {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(new Error("aborted"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      }
      return new Response(BING_RSS, { status: 200 });
    }) as typeof fetch;

    const started = Date.now();
    const result = await searchWeb("fallback test", 5, {
      fetchImpl: fakeFetch,
      timeoutMs: 800,
      providers: ["duckduckgo-html", "bing-rss"],
    });
    const elapsed = Date.now() - started;

    assert.equal(result.provider, "bing-rss");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].url, "https://example.com/bing");
    assert.ok(elapsed < 2_000, `search took ${elapsed}ms despite Bing responding immediately`);
    assert.ok(calls.some((url) => url.includes("duckduckgo.com")));
    assert.ok(calls.some((url) => url.includes("bing.com")));
  });

  it("returns an empty result set when every provider fails", async () => {
    const fakeFetch = (async () => {
      throw new Error("network unavailable");
    }) as typeof fetch;
    const result = await searchWeb("offline", 3, {
      fetchImpl: fakeFetch,
      timeoutMs: 500,
      providers: ["duckduckgo-html", "bing-rss"],
    });
    assert.deepEqual(result.results, []);
    assert.ok(result.errors.length >= 1);
  });
});
