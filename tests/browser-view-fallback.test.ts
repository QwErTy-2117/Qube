import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import {
  buildBrowserHeaders,
  decodeBody,
  pickClientLanguage,
  blockedPage,
  processHtml,
} from "../app/api/browser/view/route";
import {
  looksLikeBotWall,
  visibleTextLength,
} from "../lib/browser/chrome-render";
import { frameShimScript } from "../lib/browser/view-rewrite";

describe("browser view: browser-like request headers", () => {
  it("sends a real Chrome UA with document fetch metadata, not the Qube script UA", () => {
    const h = buildBrowserHeaders();
    assert.ok(h["User-Agent"].includes("Chrome/131"));
    assert.ok(!h["User-Agent"].includes("Qube"));
    assert.equal(h["Sec-Fetch-Dest"], "document");
    assert.equal(h["Sec-Fetch-Mode"], "navigate");
    assert.ok(h["Accept"].includes("text/html"));
    assert.ok(h["Accept-Language"].includes("en-US"));
  });
  it("forwards extra headers (e.g. POST content-type) without clobbering", () => {
    const h = buildBrowserHeaders({ "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal(h["Content-Type"], "application/x-www-form-urlencoded");
    assert.ok(h["User-Agent"].includes("Chrome"));
  });
});

describe("browser view: charset-aware body decoding", () => {
  it("decodes windows-1252 instead of mangling to UTF-8", () => {
    // "Café" in windows-1252: 0xE9 is invalid UTF-8 alone.
    const latin = Buffer.from([0x43, 0x61, 0x66, 0xe9]);
    assert.equal(decodeBody(latin, "text/html; charset=windows-1252"), "Café");
  });
  it("sniffs meta charset when the header is silent", () => {
    const body = Buffer.from(
      '<html><head><meta charset="windows-1252"></head><body>Caf\xe9</body></html>',
      "latin1"
    );
    assert.ok(decodeBody(body, "text/html").includes("Café"));
  });
  it("falls back to UTF-8 for plain bodies", () => {
    assert.equal(decodeBody(Buffer.from("hello"), "text/html"), "hello");
  });
});

describe("browser view: bot-wall detection", () => {
  it("flags the Amazon AWS WAF challenge fetch servers actually return", () => {
    const waf =
      "<html><head><script>window.gokuProps={}</script>" +
      '<script src="https://x.token.awswaf.com/challenge.js"></script></head>' +
      '<body><div id="challenge-container"></div><p>In order to continue, we need to verify that you\'re not a robot. ' +
      "This requires JavaScript. Enable JavaScript and then reload the page.</p>" +
      "<script>AwsWafIntegration.checkForceRefresh()</script></body></html>";
    const tl = visibleTextLength(waf);
    assert.ok(tl < 400, `waf textLen ${tl} should be short`);
    assert.equal(looksLikeBotWall(waf, tl), true);
  });
  it("flags Reddit's JS puzzle and NYT's captcha-delivery", () => {
    const reddit = '<html><body><script>document.forms[0].elements.namedItem("solution").value=x</script></body></html>';
    assert.equal(looksLikeBotWall(reddit, visibleTextLength(reddit)), true);
    const nyt = '<html><body><script src="https://ct.captcha-delivery.com/c.js"></script></body></html>';
    assert.equal(looksLikeBotWall(nyt, visibleTextLength(nyt)), true);
  });
  it("passes real content: example.com and Chrome-rendered Amazon", () => {
    const example =
      "<html><body><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission.</p></body></html>";
    assert.equal(looksLikeBotWall(example, visibleTextLength(example)), false);
    // Chrome-rendered Amazon has thousands of chars of nav/search content.
    const renderedAmazon = `<html><body>${"Shop deals ".repeat(600)}<div>Deliver to Italy Cart</div></body></html>`;
    const tl = visibleTextLength(renderedAmazon);
    assert.ok(tl > 1000);
    assert.equal(looksLikeBotWall(renderedAmazon, tl), false);
  });
});

describe("browser view: actionable blocked page", () => {
  it("offers Open original + Retry and escapes the URL", () => {
    const page = blockedPage("This site returned 403", "https://www.nytimes.com/");
    assert.ok(page.includes("Open original"));
    assert.ok(page.includes("Retry"));
    assert.ok(page.includes('target="_blank"'));
    const evil = blockedPage("x", 'https://example.com/"><script>alert(1)</script>');
    assert.ok(!evil.includes("<script>alert(1)"));
  });
});

describe("browser view: client language forwarding", () => {
  it("forwards sane client languages, defaults otherwise", () => {
    const fr = new Request("https://app.local/api/browser/view?url=https://example.com/", {
      headers: { "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" },
    });
    assert.ok(pickClientLanguage(fr).includes("fr-FR"));
    const empty = new Request("https://app.local/api/browser/view?url=https://example.com/");
    assert.equal(pickClientLanguage(empty), "en-US,en;q=0.9");
    // Header injection never reaches here via real Requests (undici rejects
    // CRLF), so exercise the sanitizer with a mock instead.
    const evil = {
      headers: { get: () => "en-US\r\nX-Injected: 1, fr-FR" },
    } as unknown as Request;
    assert.ok(!pickClientLanguage(evil).includes("Injected"));
  });
});

describe("browser view: runtime shim covers JS-built forms", () => {
  it("proxies form[action] set via property and setAttribute at runtime", () => {
    const shim = frameShimScript("https://proxy.local/api/browser/view?url=", "testpanel1");
    assert.ok(!shim.includes("</script"));
    const dom = new JSDOM(
      `<html><head><script>${shim}</script></head><body></body></html>`,
      { url: "https://proxy.local/api/browser/view?url=x", runScripts: "dangerously" }
    );
    const doc = dom.window.document;
    const viaProp = doc.createElement("form") as HTMLFormElement;
    viaProp.action = "https://example.com/search";
    const viaAttr = doc.createElement("form") as HTMLFormElement;
    viaAttr.setAttribute("action", "/rel/search");
    const btn = doc.createElement("button") as HTMLButtonElement;
    btn.setAttribute("formaction", "https://example.com/submit");
    for (const el of [viaProp, viaAttr, btn]) {
      const attr = el.tagName.toLowerCase() === "button" ? "formaction" : "action";
      const got = el.getAttribute(attr)!;
      assert.ok(
        got.startsWith("https://proxy.local/api/browser/view?url="),
        `${attr}=${got}`
      );
      assert.ok(got.includes("&panel=testpanel1") && !got.includes("sub=1"), got);
    }
  });
});

describe("browser view: chrome-rendered pages run through the same pipeline", () => {
  it("processHtml pins base + rewrites links on post-JS DOM", () => {
    const rendered = `<html><head><title>Amazon.com</title></head><body><a href="/s?k=books">books</a></body></html>`;
    const out = processHtml(
      rendered,
      "https://www.amazon.com/",
      "testpanel1",
      "https://proxy.local/api/browser/view?url="
    );
    assert.match(out, /<base href="https:\/\/www\.amazon\.com\/"/);
    assert.ok(out.includes("api/browser/view?url=https%3A%2F%2Fwww.amazon.com%2Fs"));
  });
});
