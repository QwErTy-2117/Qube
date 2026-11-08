/**
 * Subagent failure isolation tests.
 *
 * The harness deliberately keeps subagents one-shot and independent (no
 * recursion, no shared mutable run state). These tests prove that parallel
 * calls fail independently and that the active-run counter returns to zero
 * even when no model is configured.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-subagent-test-"));

import { getActiveSubagentCount, runSubagent } from "@/lib/pi/subagents";

describe("subagent isolation", () => {
  it("returns independent structured failures for parallel tasks", async () => {
    const [a, b] = await Promise.all([
      runSubagent({ description: "first", prompt: "summarize first input", parentThreadId: "p" }),
      runSubagent({ description: "second", prompt: "summarize second input", parentThreadId: "p" }),
    ]);
    assert.equal(a.status, "failed");
    assert.equal(b.status, "failed");
    assert.equal(a.task, "summarize first input");
    assert.equal(b.task, "summarize second input");
    assert.ok(a.error);
    assert.ok(b.error);
    assert.equal(getActiveSubagentCount(), 0);
  });

  it("rejects an empty dependent task without registering a run", async () => {
    const result = await runSubagent({ description: "empty", prompt: "   ", parentThreadId: "p" });
    assert.equal(result.status, "failed");
    assert.match(String(result.error), /empty/i);
    assert.equal(getActiveSubagentCount(), 0);
  });
});
