import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeEndpoint } from "../lib/browser/managed-chrome";

/**
 * Locks the "same backend as the OpenBot browser" contract: Qube attaches to
 * an external Chromium (e.g. the OpenBot browser) over CDP when
 * BROWSER_CDP_ENDPOINT / BROWSER_CDP_URL is set, and otherwise launches its
 * own. normalizeEndpoint is the gate that decides whether an external attach
 * happens, so it must accept only real http(s) DevTools endpoints.
 */
describe("managed-chrome: external CDP endpoint (OpenBot browser backend)", () => {
  it("accepts http(s) host:port endpoints and drops any path", () => {
    assert.equal(normalizeEndpoint("http://127.0.0.1:9222"), "http://127.0.0.1:9222");
    assert.equal(normalizeEndpoint("https://browser.example:9333"), "https://browser.example:9333");
    // Path is ignored — only scheme+host+port identify the DevTools endpoint.
    assert.equal(normalizeEndpoint("http://127.0.0.1:9222/json/version"), "http://127.0.0.1:9222");
    // Whitespace is trimmed.
    assert.equal(normalizeEndpoint("  http://127.0.0.1:9222  "), "http://127.0.0.1:9222");
  });

  it("defaults the port from the scheme when omitted", () => {
    assert.equal(normalizeEndpoint("http://host"), "http://host:80");
    assert.equal(normalizeEndpoint("https://host"), "https://host:443");
  });

  it("rejects unset, empty, non-http(s), and malformed values", () => {
    for (const bad of [
      undefined,
      "",
      "   ",
      "ftp://host:9222",
      "file:///etc/passwd",
      "ws://127.0.0.1:9222",
      "not a url",
      "127.0.0.1:9222",
    ]) {
      assert.equal(normalizeEndpoint(bad as string | undefined), null, String(bad));
    }
  });
});