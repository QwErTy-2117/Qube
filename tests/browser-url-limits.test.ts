import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateBrowserUrl, validateAgentNavUrl } from "../lib/agent/browser/ssrf";

describe("browser url limits", () => {
  it("accepts long real-world widget/search URLs (≤8192)", () => {
    // Google widget URLs with session tokens easily pass 2KB — the panel
    // proxy must serve them, not 400.
    const longQuery = `q=${"a".repeat(3000)}&tok=${"b".repeat(500)}`;
    const v = validateBrowserUrl(`https://ogs.google.com/widget/app/so?${longQuery}`);
    assert.equal(v.ok, true);
  });
  it("still rejects absurd URLs and bad input", () => {
    assert.equal(validateBrowserUrl(`https://example.com/${"x".repeat(9000)}`).ok, false);
    assert.equal(validateBrowserUrl("").ok, false);
    assert.equal(validateBrowserUrl("javascript:alert(1)").ok, false);
    assert.equal(validateBrowserUrl("http://localhost:3000/x").ok, false);
  });

});
describe("agent nav urls (browser policy: localhost ok, metadata/schemes blocked)", () => {
  it("allows localhost, loopback, LAN, and public https", () => {
    for (const u of [
      "http://localhost:3010/",
      "http://127.0.0.1:9222/json/list",
      "http://192.168.1.5/admin",
      "https://www.wikipedia.org/",
      "example.com/search?q=x",
    ]) {
      const v = validateAgentNavUrl(u);
      assert.equal(v.ok, true, `${u} should be allowed`);
    }
  });
  it("blocks cloud metadata targets", () => {
    for (const u of [
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://foo.metadata.google.internal/x",
      "http://instance-data/latest",
    ]) {
      const v = validateAgentNavUrl(u);
      assert.equal(v.ok, false, `${u} should be blocked`);
      assert.match((v as { error: string }).error, /metadata|Blocked/i);
    }
  });
  it("blocks dangerous schemes, credentials, and bad input", () => {
    assert.equal(validateAgentNavUrl("file:///etc/passwd").ok, false);
    assert.equal(validateAgentNavUrl("javascript:alert(1)").ok, false);
    assert.equal(validateAgentNavUrl("data:text/html,hi").ok, false);
    assert.equal(validateAgentNavUrl("https://user:pass@example.com/").ok, false);
    assert.equal(validateAgentNavUrl("").ok, false);
    assert.equal(validateAgentNavUrl(`https://example.com/${"x".repeat(9000)}`).ok, false);
  });
});
