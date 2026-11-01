import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normRefText,
  refHrefPath,
  refDpAsin,
  refMatchScore,
  sameBrowserPage,
} from "../lib/pi/computer-use";

describe("browser refs: descriptor normalization", () => {
  it("normalizes whitespace/case and caps length", () => {
    assert.equal(normRefText("  Add  TO\nCart  "), "add to cart");
    assert.equal(normRefText("").length, 0);
    assert.ok(normRefText("x".repeat(500)).length <= 120);
  });
  it("treats same page modulo hash/trailing slash", () => {
    assert.equal(sameBrowserPage("https://x.com/dp/B1/", "https://x.com/dp/B1#reviews"), true);
    assert.equal(sameBrowserPage("https://x.com/a", "https://x.com/b"), false);
  });
});

describe("browser refs: href-path and ASIN matching", () => {
  it("strips session query/hash for path comparison", () => {
    assert.equal(refHrefPath("https://x.com/dp/B001/?qid=12&sr=1-1#top"), "/dp/B001/");
  });
  it("extracts /dp/ASIN case-insensitively", () => {
    assert.equal(refDpAsin("https://www.amazon.com/dp/b0cxkz1234/ref=sr_1_1"), "B0CXKZ1234");
    assert.equal(refDpAsin("https://x.com/search?q=k"), "");
  });
});

describe("browser refs: match scoring survives Amazon token rotation", () => {
  const snapLink = {
    role: "link",
    name: "Keyboard Alpha $12.99",
    tag: "a",
    href: "https://shop.local/dp/B001AAAA01?psc=1&qid=7&sr=1-1",
  };
  it("re-matches the same product after qid/price rotation", () => {
    const rerendered = {
      role: "link",
      name: "Keyboard Alpha $14.99",
      tag: "a",
      href: "https://shop.local/dp/B001AAAA01?psc=1&qid=9&sr=1-3",
    };
    // tag(2) + role(1) + ASIN(5) = 8 despite name/href drift.
    assert.ok(refMatchScore(snapLink, rerendered) >= 6);
  });
  it("still matches identical descriptors strongly", () => {
    assert.ok(refMatchScore(snapLink, { ...snapLink }) >= 10);
  });
  it("rejects a different product on the same page", () => {
    const other = {
      role: "link",
      name: "Mouse Beta $9.99",
      tag: "a",
      href: "https://shop.local/dp/B002BBBB02?psc=1&qid=9",
    };
    // tag(2) + role(1) only — must NOT heal onto the wrong product.
    assert.ok(refMatchScore(snapLink, other) < 6);
  });
  it("matches same-path links without ASINs", () => {
    const a = { role: "link", name: "Deals", tag: "a", href: "https://x.com/deals?tab=1" };
    const b = { role: "link", name: "Deals", tag: "a", href: "https://x.com/deals?tab=2" };
    assert.ok(refMatchScore(a, b) >= 6);
  });
});
