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
  shouldIdleContinue,
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
