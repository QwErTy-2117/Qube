import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateBrowserUrl } from "../lib/agent/browser/ssrf";

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
