/**
 * Updater progress tests — download percent helper used by the update toast.
 *
 * The update button used to sit at a static "Updating…" with no feedback
 * while multi-MB bundles downloaded (progress events were swallowed),
 * making every normal download look frozen.
 *
 * Run: npx tsx --test tests/updater-progress.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { downloadProgressPercent } from "@/lib/updater";

describe("downloadProgressPercent", () => {
  it("returns null when the total size is unknown", () => {
    assert.equal(downloadProgressPercent(0, undefined), null);
    assert.equal(downloadProgressPercent(500, undefined), null);
    assert.equal(downloadProgressPercent(500, 0), null);
  });

  it("computes whole percent, clamped to 0..100", () => {
    assert.equal(downloadProgressPercent(0, 1000), 0);
    assert.equal(downloadProgressPercent(500, 1000), 50);
    assert.equal(downloadProgressPercent(999, 1000), 99);
    assert.equal(downloadProgressPercent(1000, 1000), 100);
    // Overshoot (duplicate chunks) never exceeds 100
    assert.equal(downloadProgressPercent(1500, 1000), 100);
  });

  it("accumulates chunk by chunk like the toast does", () => {
    const total = 10_000_000;
    let downloaded = 0;
    const chunks = [1_000_000, 2_500_000, 3_000_000, 3_500_000];
    const expected = [10, 35, 65, 100];
    chunks.forEach((c, i) => {
      downloaded += c;
      assert.equal(downloadProgressPercent(downloaded, total), expected[i]);
    });
  });
});
