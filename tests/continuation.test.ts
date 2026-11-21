/**
 * Silent goal-continuation helpers — pure units, no model calls.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/continuation.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  maxSilentRounds,
  maxGoalRounds,
  maxStalledGoalRounds,
  maxGoalErrorRounds,
  maxInheritedGoalRounds,
  getIncompleteTodos,
  hasUnfinishedGoals,
  findLastTodoSnapshot,
  goalProgressSignature,
  shouldContinueGoals,
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

  it("allows an inherited plan to be dropped honestly", () => {
    const inherited = buildContinuationNudge([{ content: "Old step", status: "pending" }], null, { inherited: true });
    assert.match(inherited, /from earlier/);
    assert.match(inherited, /do not revive old work/i);
    // A plan written this run keeps the firm "keep working" framing.
    const fresh = buildContinuationNudge([{ content: "Now", status: "in_progress" }]);
    assert.doesNotMatch(fresh, /from earlier/);
    assert.match(fresh, /Keep working NOW/);
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
      process.env.QUBE_SILENT_CONTINUATIONS = "100000";
      assert.equal(maxSilentRounds(), 100);
    } finally {
      if (prev === undefined) delete process.env.QUBE_SILENT_CONTINUATIONS;
      else process.env.QUBE_SILENT_CONTINUATIONS = prev;
    }
  });

});

describe("goal continuation budget", () => {
  const withEnv = (name: string, value: string | undefined, fn: () => void) => {
    const prev = process.env[name];
    try {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
      fn();
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };

  it("is much larger than the nudge budget and stays bounded", () => {
    withEnv("QUBE_GOAL_CONTINUATIONS", undefined, () => {
      assert.equal(maxGoalRounds(), 30);
      assert.ok(maxGoalRounds() > maxSilentRounds());
    });
    withEnv("QUBE_GOAL_CONTINUATIONS", "0", () => assert.equal(maxGoalRounds(), 0));
    withEnv("QUBE_GOAL_CONTINUATIONS", "12", () => assert.equal(maxGoalRounds(), 12));
    withEnv("QUBE_GOAL_CONTINUATIONS", "nonsense", () => assert.equal(maxGoalRounds(), 30));
    withEnv("QUBE_GOAL_CONTINUATIONS", "100000", () => assert.equal(maxGoalRounds(), 500));
  });

  it("bounds the small budget granted to an inherited plan", () => {
    withEnv("QUBE_GOAL_INHERITED_ROUNDS", undefined, () => assert.equal(maxInheritedGoalRounds(), 5));
    withEnv("QUBE_GOAL_INHERITED_ROUNDS", "0", () => assert.equal(maxInheritedGoalRounds(), 0));
    withEnv("QUBE_GOAL_INHERITED_ROUNDS", "99", () => assert.equal(maxInheritedGoalRounds(), 50));
    // Never larger than the normal goal budget: stale work cannot outlast it.
    assert.ok(maxInheritedGoalRounds() < maxGoalRounds());
  });

  it("bounds stall and error guards", () => {
    withEnv("QUBE_GOAL_STALL_ROUNDS", undefined, () => assert.equal(maxStalledGoalRounds(), 3));
    withEnv("QUBE_GOAL_STALL_ROUNDS", "0", () => assert.equal(maxStalledGoalRounds(), 3));
    withEnv("QUBE_GOAL_STALL_ROUNDS", "99", () => assert.equal(maxStalledGoalRounds(), 20));
    withEnv("QUBE_GOAL_ERROR_ROUNDS", undefined, () => assert.equal(maxGoalErrorRounds(), 2));
    withEnv("QUBE_GOAL_ERROR_ROUNDS", "0", () => assert.equal(maxGoalErrorRounds(), 0));
    withEnv("QUBE_GOAL_ERROR_ROUNDS", "99", () => assert.equal(maxGoalErrorRounds(), 10));
  });
});

describe("shouldContinueGoals (goal-driven continuation)", () => {
  const ok = {
    hasUnfinished: true,
    rounds: 0,
    budget: 30,
    stalledRounds: 0,
    stallLimit: 3,
    consecutiveErrors: 0,
    errorLimit: 2,
    aborted: false,
  };

  it("continues while goals are open, well past the old 8-round silent cap", () => {
    assert.equal(shouldContinueGoals(ok), true);
    // The regression this guards: rounds 9+ must still run.
    assert.equal(shouldContinueGoals({ ...ok, rounds: 8 }), true);
    assert.equal(shouldContinueGoals({ ...ok, rounds: 29 }), true);
  });

  it("does not revive an inherited plan for a run that did no work", () => {
    // "hi" with an old open checklist must not restart the old work.
    assert.equal(shouldContinueGoals({ ...ok, hasRunWork: false }), false);
    assert.equal(shouldContinueGoals({ ...ok, hasRunWork: true }), true);
  });

  it("stops on completion, budget, stall, repeated errors and abort", () => {
    assert.equal(shouldContinueGoals({ ...ok, hasUnfinished: false }), false);
    assert.equal(shouldContinueGoals({ ...ok, rounds: 30 }), false);
    assert.equal(shouldContinueGoals({ ...ok, stalledRounds: 3 }), false);
    assert.equal(shouldContinueGoals({ ...ok, consecutiveErrors: 3 }), false);
    assert.equal(shouldContinueGoals({ ...ok, aborted: true }), false);
    // A single transient error does not abandon the plan.
    assert.equal(shouldContinueGoals({ ...ok, consecutiveErrors: 2 }), true);
  });
});

describe("goalProgressSignature", () => {
  it("changes when an item completes or a tool call succeeds", () => {
    const before = goalProgressSignature([{ content: "A", status: "pending" }], 0);
    const afterComplete = goalProgressSignature([{ content: "A", status: "completed" }], 0);
    const afterTool = goalProgressSignature([{ content: "A", status: "pending" }], 1);
    assert.notEqual(before, afterComplete);
    assert.notEqual(before, afterTool);
    assert.equal(afterTool, goalProgressSignature([{ content: "A", status: "pending" }], 1));
  });
});

describe("findLastTodoSnapshot", () => {
  it("recovers the newest TodoWrite list from prior UI messages", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "build it" }] },
      {
        role: "assistant",
        parts: [
          { type: "tool-call", toolName: "TodoWrite", input: { todos: [{ content: "Old", status: "completed" }] } },
        ],
      },
      {
        role: "assistant",
        parts: [
          { type: "tool-call", toolName: "TodoWrite", args: { todos: [{ content: "New", status: "pending" }] } },
          { type: "text", text: "working" },
        ],
      },
    ];
    const snap = findLastTodoSnapshot(messages);
    assert.deepEqual(snap, [{ content: "New", status: "pending" }]);
  });

  it("reads dynamic and tool-input-available shapes", () => {
    const dynamic = findLastTodoSnapshot([
      {
        role: "assistant",
        parts: [
          { type: "dynamic-tool", toolName: "TodoWrite", input: { todos: [{ content: "Dyn", status: "in_progress" }] } },
        ],
      },
    ]);
    assert.deepEqual(dynamic, [{ content: "Dyn", status: "in_progress" }]);
    const legacy = findLastTodoSnapshot([
      { role: "assistant", parts: [{ type: "tool-TodoWrite", input: { todos: [{ content: "Legacy", status: "pending" }] } }] },
    ]);
    assert.deepEqual(legacy, [{ content: "Legacy", status: "pending" }]);
  });

  it("returns null when no plan exists or input is malformed", () => {
    assert.equal(findLastTodoSnapshot(null), null);
    assert.equal(findLastTodoSnapshot([]), null);
    assert.equal(findLastTodoSnapshot([{ role: "assistant", parts: [{ type: "tool-call", toolName: "read_file", input: {} }] }]), null);
    assert.equal(
      findLastTodoSnapshot([{ role: "assistant", parts: [{ type: "tool-call", toolName: "TodoWrite", input: { todos: "nope" } }] }]),
      null,
    );
  });

  it("treats cancelled items as terminal, not unfinished", () => {
    assert.equal(hasUnfinishedGoals([{ content: "A", status: "cancelled" }]), false);
    assert.equal(hasUnfinishedGoals([{ content: "A", status: "cancelled" }, { content: "B", status: "pending" }]), true);
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
  it("treats any string error without explicit ok:true as failure", () => {
    const blocked = extractToolError("browser_navigate", JSON.stringify({ url: "http://169.254.169.254/", title: "", error: "Blocked cloud instance-metadata address" }));
    assert.match(blocked || "", /Blocked cloud/);
    assert.equal(extractToolError("t", JSON.stringify({ ok: true, error: "" })), null);
    assert.equal(extractToolError("t", JSON.stringify({ ok: true, note: "fine" })), null);
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
