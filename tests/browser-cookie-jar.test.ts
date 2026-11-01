import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { clearCookieJar, cookieHeaderFor, storeCookiesFromResponse } from "../lib/browser/cookie-jar";

function resWithCookies(setCookies: string[]): Response {
  const headers = new Headers();
  for (const sc of setCookies) headers.append("set-cookie", sc);
  return new Response("x", { headers });
}

describe("browser cookie jar", () => {
  beforeEach(() => clearCookieJar());

  it("stores and sends cookies per host", () => {
    storeCookiesFromResponse(resWithCookies(["sid=abc123; Path=/; Max-Age=3600"]), "www.google.com");
    assert.equal(cookieHeaderFor("https://www.google.com/search?q=x"), "sid=abc123");
    assert.equal(cookieHeaderFor("https://other.com/"), undefined);
  });
  it("shares domain cookies with subdomains, refuses foreign domains", () => {
    storeCookiesFromResponse(resWithCookies(["d=1; Domain=.google.com"]), "consent.google.com");
    assert.ok(cookieHeaderFor("https://www.google.com/")?.includes("d=1"));
    storeCookiesFromResponse(resWithCookies(["evil=1; Domain=evil.com"]), "www.google.com");
    assert.equal(cookieHeaderFor("https://evil.com/"), undefined);
  });
  it("drops expired cookies and honors Secure", () => {
    storeCookiesFromResponse(
      resWithCookies(["old=gone; Max-Age=0", "sec=s; Secure", "plain=p"]),
      "example.com"
    );
    assert.equal(cookieHeaderFor("http://example.com/"), "plain=p");
    assert.equal(cookieHeaderFor("https://example.com/"), "sec=s; plain=p");
  });
});
