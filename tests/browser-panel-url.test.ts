import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { toProxyUrl, rewriteMetaRefresh, rewriteNavigations, frameShimScript } from "../lib/browser/view-rewrite";
import { isValidPanelToken, recordPanelUrl, recallPanelUrl } from "../lib/browser/panel-urls";
import { processHtml } from "../app/api/browser/view/route";

const OPTS = { pageUrl: "https://example.com/a/b", proxyPrefix: "/api/browser/view?url=", panel: "testpanel1" };

describe("browser panel-url: link rewriting", () => {
  it("proxies relative and absolute http(s) links", () => {
    assert.equal(
      toProxyUrl("/next", OPTS),
      "/api/browser/view?url=https%3A%2F%2Fexample.com%2Fnext&panel=testpanel1"
    );
    assert.ok(toProxyUrl("https://other.com/x?q=1", OPTS)?.includes("other.com"));
  });
  it("leaves non-navigational schemes alone", () => {
    for (const bad of ["javascript:void(0)", "mailto:a@b.c", "#section", "data:text/plain,hi", ""]) {
      assert.equal(toProxyUrl(bad, OPTS), null);
    }
  });
  it("rewrites anchors/forms, skips assets and javascript links", () => {
    const dom = new JSDOM(`<html><head></head><body>
      <a href="/p1">one</a>
      <a href="javascript:void(0)">js</a>
      <a href="#frag">frag</a>
      <link rel="stylesheet" href="/s.css">
      <img src="/i.png">
      <form action="/search" method="get"><input name="q"></form>
    </body></html>`);
    const { rewroteLinks, rewroteForms } = rewriteNavigations(dom.window.document, OPTS);
    assert.equal(rewroteLinks, 1);
    assert.equal(rewroteForms, 1);
    const doc = dom.window.document;
    assert.match(doc.querySelector("a[href]")!.getAttribute("href")!, /\/api\/browser\/view\?url=/);
    assert.equal(doc.querySelectorAll("a")[1].getAttribute("href"), "javascript:void(0)");
    assert.equal(doc.querySelector('link[rel="stylesheet"]')!.getAttribute("href"), "/s.css");
    assert.equal(doc.querySelector("img")!.getAttribute("src"), "/i.png");
    assert.match(doc.querySelector("form")!.getAttribute("action")!, /\/api\/browser\/view\?url=/);
  });
  it("routes nested browsing contexts through the proxy (absolute, base-proof)", () => {
    const dom = new JSDOM(`<html><head><base href="https://phet.colorado.edu/"></head><body>
      <iframe src="https://phet.colorado.edu/sims/html/balancing-chemical-equations/latest/balancing-chemical-equations_en.html"></iframe>
      <iframe src="about:blank"></iframe>
      <object data="/sims/x"></object>
      <video src="/v.mp4"></video>
    </body></html>`, { url: "https://proxy.local/api/browser/view?url=x" });
    const { rewroteEmbeds } = rewriteNavigations(dom.window.document, {
      pageUrl: "https://phet.colorado.edu/",
      proxyPrefix: "https://proxy.local/api/browser/view?url=",
      panel: "testpanel1",
    });
    assert.equal(rewroteEmbeds, 2);
    const doc = dom.window.document;
    const frames = [...doc.querySelectorAll("iframe")].map((f) => (f as HTMLIFrameElement).src);
    // Absolute proxy origin survives the foreign <base> tag.
    assert.ok(frames[0].startsWith("https://proxy.local/api/browser/view?url=https%3A%2F%2Fphet.colorado.edu%2Fsims%2F"));
    assert.equal(frames[1], "about:blank");
    assert.ok((doc.querySelector("object")!.getAttribute("data") || "").startsWith("https://proxy.local/"));
    // Media stays direct.
    assert.equal(doc.querySelector("video")!.getAttribute("src"), "/v.mp4");
  });
  it("never double-wraps an already-proxied URL", () => {
    const once = toProxyUrl("/p", OPTS)!;
    const dom = new JSDOM(`<a href="${once}">x</a>`);
    rewriteNavigations(dom.window.document, OPTS);
    const href = dom.window.document.querySelector("a")!.getAttribute("href")!;
    assert.equal(href, once);
  });
  it("rewrites meta refresh targets", () => {
    const out = rewriteMetaRefresh("0; url=/next", OPTS);
    assert.match(out, /\/api\/browser\/view\?url=/);
  });
});

describe("browser panel-url: runtime frame shim", () => {
  it("proxies runtime-created embeds via property and setAttribute", () => {
    const shim = frameShimScript("https://proxy.local/api/browser/view?url=", "testpanel1");
    assert.ok(!shim.includes("</script"));
    const dom = new JSDOM(`<html><head><script>${shim}</script></head><body></body></html>`, {
      url: "https://proxy.local/api/browser/view?url=x",
      runScripts: "dangerously",
    });
    const doc = dom.window.document;
    const viaProp = doc.createElement("iframe") as HTMLIFrameElement;
    viaProp.src = "https://phet.colorado.edu/sims/a.html";
    const viaAttr = doc.createElement("embed") as HTMLEmbedElement;
    viaAttr.setAttribute("src", "/rel/sim.html");
    const skipped = doc.createElement("iframe") as HTMLIFrameElement;
    skipped.setAttribute("src", "about:blank");
    for (const [el, want] of [
      [viaProp, "https://proxy.local/api/browser/view?url=https%3A%2F%2Fphet"],
      [viaAttr, "https://proxy.local/api/browser/view?url="],
    ] as const) {
      assert.ok(el.getAttribute("src")!.startsWith(want), el.getAttribute("src")!);
    }
    assert.equal(skipped.getAttribute("src"), "about:blank");
    // Runtime-created LINKS stay tracked (no sub flag); embeds are flagged.
    const link = doc.createElement("a") as HTMLAnchorElement;
    link.href = "https://example.com/p";
    const linkHref = link.getAttribute("href")!;
    assert.ok(linkHref.includes("&panel=testpanel1") && !linkHref.includes("sub=1"), linkHref);
    assert.ok(viaProp.getAttribute("src")!.includes("sub=1"));
  });
});

describe("browser panel-url: subframe tracking split", () => {
  const OPTS = { pageUrl: "https://example.com/", proxyPrefix: "https://proxy.local/api/browser/view?url=", panel: "testpanel1" };
  it("main docs: links untracked, embeds flagged sub=1", () => {
    const dom = new JSDOM(`<html><head></head><body><a href="/p">x</a><iframe src="/f"></iframe></body></html>`);
    rewriteNavigations(dom.window.document, OPTS);
    const doc = dom.window.document;
    const link = doc.querySelector("a")!.getAttribute("href")!;
    assert.ok(link.includes("&panel=testpanel1") && !link.includes("sub=1"), link);
    const frame = doc.querySelector("iframe")!.getAttribute("src")!;
    assert.ok(frame.includes("&panel=testpanel1&sub=1"), frame);
  });
  it("subframe docs: links inherit sub=1", () => {
    const dom = new JSDOM(`<html><head></head><body><a href="/p">x</a></body></html>`);
    rewriteNavigations(dom.window.document, { ...OPTS, isSubframe: true });
    const link = dom.window.document.querySelector("a")!.getAttribute("href")!;
    assert.ok(link.includes("sub=1"), link);
  });
  it("subframe GET forms keep the flag as a hidden input", () => {
    const dom = new JSDOM(`<html><head></head><body><form action="/s" method="get"><input name="q"></form></body></html>`);
    rewriteNavigations(dom.window.document, { ...OPTS, isSubframe: true });
    const form = dom.window.document.querySelector("form")!;
    assert.equal(form.querySelector('input[name="sub"]')!.getAttribute("value"), "1");
  });
});

describe("browser panel-url: processHtml", () => {
  it("strips page CSP, pins base, rewrites links", () => {
    const out = processHtml(
      `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body><a href="/p">x</a></body></html>`,
      "https://example.com/",
      "testpanel1"
    );
    assert.ok(!/content-security-policy/i.test(out));
    assert.match(out, /<base href="https:\/\/example\.com\/"/);
    assert.match(out, /\/api\/browser\/view\?url=/);
  });
  it("emits absolute proxy URLs that survive the foreign <base> tag", () => {
    const out = processHtml(
      `<html><head></head><body><a href="/p1">one</a></body></html>`,
      "https://example.com/a",
      "testpanel1",
      "https://proxy.local/api/browser/view?url="
    );
    // Resolve exactly like a browser: document with the injected base.
    const dom = new JSDOM(out, { url: "https://proxy.local/api/browser/view?url=x" });
    const a = dom.window.document.querySelector('a[href*="api/browser/view"]')! as HTMLAnchorElement;
    assert.ok(a.getAttribute("href")!.startsWith("https://proxy.local/api/browser/view?url="));
    assert.ok(a.href.startsWith("https://proxy.local/api/browser/view?url="));
  });
  it("preserves GET form targets as hidden inputs", () => {
    const out = processHtml(
      `<html><head></head><body><form action="/search" method="get"><input name="q"></form></body></html>`,
      "https://example.com/",
      "testpanel1",
      "https://proxy.local/api/browser/view?url="
    );
    const dom = new JSDOM(out);
    const form = dom.window.document.querySelector("form")!;
    assert.ok(form.getAttribute("action")!.startsWith("https://proxy.local/"));
    assert.equal(form.querySelector('input[name="url"]')!.getAttribute("value"), "https://example.com/search");
    assert.equal(form.querySelector('input[name="panel"]')!.getAttribute("value"), "testpanel1");
  });
});

describe("browser panel-url: search dead-end detection", () => {
  it("flags the bot-check interstitial, not consent forms or real results", async () => {
    const { detectSearchDeadEnd, searchDeadEndPage } = await import("../app/api/browser/view/route");
    const interstitial = `<html><head><title>Google Search</title></head><body><p>Se non vieni reindirizzato, fai clic qui.</p><a href="/search?q=x&sxsrf=1">x</a></body></html>`;
    const hit = detectSearchDeadEnd("https://www.google.com/search?hl=it&q=hotmail&ucbcb=1", interstitial, 189);
    assert.ok(hit && hit.query === "hotmail", JSON.stringify(hit));
    const consentForm = `<html><body><p>Cookie settings text here</p><form action="/save" method="POST"><button>Reject</button></form></body></html>`;
    assert.equal(detectSearchDeadEnd("https://consent.google.com/dl?x=1", consentForm, 400), null);
    const results = `<html><body>${"results text ".repeat(100)}<a href="/url?q=https://example.com">r</a></body></html>`;
    assert.equal(detectSearchDeadEnd("https://www.google.com/search?q=x", results, 1500), null);
    assert.equal(detectSearchDeadEnd("https://en.wikipedia.org/wiki/X", interstitial, 100), null);
    const page = searchDeadEndPage({ host: "www.google.com", query: "hotmail" }, "https://panel.local", "tok1");
    assert.ok(page.includes("duckduckgo.com"), "offers the working alternative");
    assert.ok(page.includes("panel=tok1"), "tracking continues");
  });
});

describe("browser panel-url: token store", () => {
  it("validates tokens and recalls last URL", () => {
    assert.equal(isValidPanelToken("abc12345"), true);
    assert.equal(isValidPanelToken("x"), false);
    assert.equal(isValidPanelToken("../../etc"), false);
    recordPanelUrl("abc12345", "https://example.com/final");
    assert.equal(recallPanelUrl("abc12345"), "https://example.com/final");
    assert.equal(recallPanelUrl("missing00"), null);
  });
});
