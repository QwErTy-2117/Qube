/**
 * Silent goal-continuation helpers — pure units, no model calls.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/continuation.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  maxSilentRounds,
  getIncompleteTodos,
  hasUnfinishedGoals,
  buildContinuationNudge,
  buildRecoveryNudge,
  shouldIdleContinue,
  shouldRecoverContinue,
  extractToolError,
} from "@/lib/pi/continuation";

describe("shouldIdleContinue (stall recovery)", () => {
  it("never re-continues a round that produced a text answer", () => {
    // The 'hi' bug: a plain reply with no tools must NOT be re-run.
    assert.equal(shouldIdleContinue({ toolCallCount: 0, producedText: true, silentRounds: 0, budget: 8 }), false);
  });

  it("does not continue when tools were called", () => {
    assert.equal(shouldIdleContinue({ toolCallCount: 2, producedText: false, silentRounds: 0, budget: 8 }), false);
  });

  it("continues only on a genuine stall (no text, no tools)", () => {
    assert.equal(shouldIdleContinue({ toolCallCount: 0, producedText: false, silentRounds: 0, budget: 8 }), true);
  });

  it("stops at the silent budget", () => {
    assert.equal(shouldIdleContinue({ toolCallCount: 0, producedText: false, silentRounds: 8, budget: 8 }), false);
    assert.equal(shouldIdleContinue({ toolCallCount: 0, producedText: false, silentRounds: 0, budget: 0 }), false);
  });
});

describe("getIncompleteTodos", () => {
  it("returns pending and in_progress items only", () => {
    const todos = [
      { content: "Done thing", status: "completed", activeForm: "Doing thing" },
      { content: "Current thing", status: "in_progress", activeForm: "Doing current" },
      { content: "Later thing", status: "pending", activeForm: "Doing later" },
    ];
    const out = getIncompleteTodos(todos);
    assert.equal(out.length, 2);
    assert.equal(out[0].content, "Current thing");
    assert.equal(out[1].content, "Later thing");
  });

  it("returns [] for all-completed, empty, and non-array input", () => {
    assert.deepEqual(getIncompleteTodos([{ content: "A", status: "completed" }]), []);
    assert.deepEqual(getIncompleteTodos([]), []);
    assert.deepEqual(getIncompleteTodos(null), []);
    assert.deepEqual(getIncompleteTodos(undefined), []);
    assert.deepEqual(getIncompleteTodos("todos"), []);
  });
});

describe("hasUnfinishedGoals", () => {
  it("is true only when a non-empty list has incomplete items", () => {
    assert.equal(hasUnfinishedGoals([{ content: "A", status: "pending" }]), true);
    assert.equal(
      hasUnfinishedGoals([
        { content: "A", status: "completed" },
        { content: "B", status: "in_progress" },
      ]),
      true,
    );
    assert.equal(hasUnfinishedGoals([{ content: "A", status: "completed" }]), false);
    assert.equal(hasUnfinishedGoals([]), false);
    assert.equal(hasUnfinishedGoals(null), false);
  });
});

describe("buildContinuationNudge", () => {
  it("lists remaining items and stays silent (never user-visible framing)", () => {
    const nudge = buildContinuationNudge([
      { content: "Run tests", status: "in_progress" },
      { content: "Update docs", status: "pending" },
    ]);
    assert.match(nudge, /silent continuation/i);
    assert.match(nudge, /Do not display/i);
    assert.match(nudge, /Run tests/);
    assert.match(nudge, /Update docs/);
    assert.match(nudge, /TodoWrite/);
  });

  it("caps very long lists", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ content: `Step ${i}`, status: "pending" }));
    const nudge = buildContinuationNudge(many);
    assert.match(nudge, /\+8 more/);
  });

  it("includes the last tool error when provided, omits it otherwise", () => {
    const withErr = buildContinuationNudge(
      [{ content: "Add to cart", status: "in_progress" }],
      "act: Stale ref e13: the page changed",
    );
    assert.match(withErr, /Stale ref e13/);
    assert.match(withErr, /Recover from that specific error/i);
    const withoutErr = buildContinuationNudge([{ content: "Add to cart", status: "in_progress" }]);
    assert.doesNotMatch(withoutErr, /Last tool call failed/);
    const emptyErr = buildContinuationNudge([{ content: "Add to cart", status: "pending" }], "   ");
    assert.doesNotMatch(emptyErr, /Last tool call failed/);
  });
});

describe("shouldRecoverContinue (failure recovery)", () => {
  it("continues when tools ran and the last one failed", () => {
    assert.equal(shouldRecoverContinue({ toolCallCount: 3, lastError: "browser_act: Stale ref e4", silentRounds: 0, budget: 8 }), true);
  });

  it("does not continue without tool calls, without an error, or at budget", () => {
    assert.equal(shouldRecoverContinue({ toolCallCount: 0, lastError: "browser_act: boom", silentRounds: 0, budget: 8 }), false);
    assert.equal(shouldRecoverContinue({ toolCallCount: 2, lastError: null, silentRounds: 0, budget: 8 }), false);
    assert.equal(shouldRecoverContinue({ toolCallCount: 2, lastError: "   ", silentRounds: 0, budget: 8 }), false);
    assert.equal(shouldRecoverContinue({ toolCallCount: 2, lastError: "browser_act: boom", silentRounds: 8, budget: 8 }), false);
  });

  it("builds a silent recovery nudge naming the error", () => {
    const nudge = buildRecoveryNudge("browser_act: Stale ref e4: page re-rendered");
    assert.match(nudge, /silent continuation/i);
    assert.match(nudge, /Stale ref e4/);
    assert.match(nudge, /Never repeat the exact failed call/);
  });
});

describe("maxSilentRounds", () => {
  it("defaults to 8 and honors env override", () => {
    const prev = process.env.QUBE_SILENT_CONTINUATIONS;
    try {
      delete process.env.QUBE_SILENT_CONTINUATIONS;
      assert.equal(maxSilentRounds(), 8);
      process.env.QUBE_SILENT_CONTINUATIONS = "0";
      assert.equal(maxSilentRounds(), 0);
      process.env.QUBE_SILENT_CONTINUATIONS = "5";
      assert.equal(maxSilentRounds(), 5);
      process.env.QUBE_SILENT_CONTINUATIONS = "bogus";
      assert.equal(maxSilentRounds(), 8);
    } finally {
      if (prev === undefined) delete process.env.QUBE_SILENT_CONTINUATIONS;
      else process.env.QUBE_SILENT_CONTINUATIONS = prev;
    }
  });

});
describe("extractToolError", () => {
  it("reads MCP isError objects", () => {
    const err = extractToolError("act", { isError: true, content: [{ text: "Stale ref e2" }] });
    assert.match(err || "", /Stale ref e2/);
    assert.equal(extractToolError("snapshot", { content: [{ text: "ok" }], isError: false }), null);
  });
  it("reads error:-prefixed text and Pi JSON errors", () => {
    assert.match(extractToolError("t", "error: boom") || "", /boom/);
    assert.match(extractToolError("t", JSON.stringify({ error: true, message: "bad" })) || "", /bad/);
    assert.match(extractToolError("t", JSON.stringify({ ok: false, message: "nope" })) || "", /nope/);
  });
  it("reads kernel block and deny shapes", () => {
    const blocked = extractToolError("browser_act", JSON.stringify({ blocked: "repeat_failure", tool: "browser_act", message: "STOP repeating" }));
    assert.match(blocked || "", /blocked.*repeat_failure/);
    assert.match(blocked || "", /STOP repeating/);
    const denied = extractToolError("browser_act", JSON.stringify({ error: "Operation not permitted", tool: "browser_act", message: "did not approve" }));
    assert.match(denied || "", /not permitted/i);
  });
  it("returns null for clean results", () => {
    assert.equal(extractToolError("t", JSON.stringify({ ok: true, url: "https://x.com/" })), null);
    assert.equal(extractToolError("t", JSON.stringify({ command: "ls", exitCode: 0 })), null);
    assert.equal(extractToolError("t", "plain text result"), null);
    assert.equal(extractToolError("t", null), null);
    // Truncated JSON keeps the old fallback: flag survives unparseable payloads.
    assert.match(extractToolError("t", '{"error":true, broken') || "", /\{"error":true/);
  });
});
