/**
 * Context compaction tests — pure units + checkpoint behavior.
 *
 * Covers: token estimation, serialization bounds (tool truncation, media
 * placeholders), turn-boundary cut points, anchor roundtrip, checkpoint
 * persistence, under-threshold passthrough, checkpoint re-application
 * without an LLM call, and fail-open summarization when no model exists.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/compaction.test.ts
 * (or `npm test`, which provisions an isolated temp dir automatically)
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Env must be set before store modules load (isolated temp data dir).
process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-compact-test-"));

import {
  estimateTokens,
  estimateMessagesTokens,
  serializeUiMessage,
  findCutPoint,
  anchorForMessage,
  findAnchorIndex,
  buildSummaryPrompt,
  formatSummaryBlock,
  isContextOverflowError,
  getCompactionConfig,
  loadCompaction,
  saveCompaction,
  clearCompaction,
  maybeCompactMessages,
  SUMMARY_SECTIONS,
  validateCompactionSummary,
  ensureSummaryObjective,
  capSummary,
  extractSummarySection,
  type SummaryFn,
  type UiMessage,
} from "@/lib/pi/compaction";
import {
  parseCompactionData,
  formatCompactionNotice,
} from "@/lib/chat/compaction-notice";

const user = (text: string): UiMessage => ({ role: "user", parts: [{ type: "text", text }] });
const assistant = (text: string): UiMessage => ({ role: "assistant", parts: [{ type: "text", text }] });

function bigUser(n: number, chars = 4000): UiMessage {
  return { role: "user", parts: [{ type: "text", text: `question ${n}: ${"x".repeat(chars)}` }] };
}

/** A structurally complete summary, as the summarizer is instructed to emit. */
function makeSummary(objective: string): string {
  return [
    `## Objective\n${objective}`,
    "## Requirements & Constraints\nKeep existing APIs working.",
    "## Decisions\nCheckpoint the boundary instead of rewriting history.",
    "## Work State\nCompleted: unit tests. In Progress: documentation.",
    "## Next Move\nRun the full suite.",
    "## Relevant Files\nlib/pi/compaction.ts",
    "## Important Context\nNone.",
  ].join("\n\n");
}

describe("estimateTokens", () => {
  it("uses ceil(chars/4)", () => {
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcde"), 2);
    assert.equal(estimateTokens("x".repeat(4000)), 1000);
  });

  it("sums serialized messages", () => {
    const msgs = [user("hello"), assistant("hi there")];
    const total = estimateMessagesTokens(msgs, 2000);
    assert.ok(total > 0);
    assert.ok(total < 100);
  });
});

describe("serializeUiMessage", () => {
  it("truncates long tool outputs", () => {
    const m: UiMessage = {
      role: "assistant",
      parts: [
        { type: "tool-call", toolName: "run_command", args: { cmd: "ls" } },
        { type: "tool-result", toolName: "run_command", output: "y".repeat(10000) },
      ],
    };
    const s = serializeUiMessage(m, 2000);
    assert.ok(s.includes("[tool call: run_command"));
    assert.ok(s.includes("[tool result: run_command]"));
    assert.ok(s.includes("truncated"));
    assert.ok(s.length < 10000);
  });

  it("reduces media to placeholders", () => {
    const m: UiMessage = {
      role: "user",
      parts: [{ type: "file", mime: "image/png", filename: "shot.png" }],
    };
    const s = serializeUiMessage(m, 2000);
    assert.ok(s.includes("[Attached image/png: shot.png]"));
  });

  it("keeps plain text", () => {
    const s = serializeUiMessage(user("hello world"), 2000);
    assert.ok(s.startsWith("user:"));
    assert.ok(s.includes("hello world"));
  });
});

describe("findCutPoint", () => {
  it("returns null when everything fits", () => {
    assert.equal(findCutPoint([user("a"), assistant("b")], 15000, 2000), null);
  });

  it("returns null for a single message", () => {
    assert.equal(findCutPoint([bigUser(1, 80000)], 1000, 2000), null);
  });

  it("cuts at a user boundary and keeps the tail within budget", () => {
    const msgs: UiMessage[] = [];
    for (let i = 0; i < 6; i++) {
      msgs.push(bigUser(i), assistant(`answer ${i} ${"y".repeat(4000)}`));
    }
    const cut = findCutPoint(msgs, 3000, 2000);
    assert.ok(cut !== null && cut > 0 && cut < msgs.length);
    assert.equal((msgs[cut!] as any).role, "user");
    const tailTokens = estimateMessagesTokens(msgs.slice(cut!), 2000);
    assert.ok(tailTokens <= 3000 + 1500); // budget + one message slack
  });

  it("keeps the newest message even when it alone exceeds the budget", () => {
    const msgs = [user("small"), bigUser(1, 8000)];
    assert.equal(findCutPoint(msgs, 100, 2000), 1);
  });
});

describe("anchors", () => {
  it("roundtrips through findAnchorIndex", () => {
    const msgs = [user("one"), assistant("two"), user("three")];
    const anchor = anchorForMessage(msgs[1], 2000);
    assert.equal(findAnchorIndex(msgs, anchor, 2000), 1);
    assert.equal(findAnchorIndex(msgs, "deadbeef", 2000), -1);
  });

  it("is stable for identical content", () => {
    assert.equal(anchorForMessage(user("same"), 2000), anchorForMessage(user("same"), 2000));
  });
});

describe("summary prompt", () => {
  it("contains every structured section", () => {
    const p = buildSummaryPrompt({});
    for (const h of SUMMARY_SECTIONS) {
      assert.ok(p.includes(h), `missing ${h}`);
    }
  });

  it("folds in a previous summary for iterative compaction", () => {
    const p = buildSummaryPrompt({ previousSummary: "old stuff" });
    assert.ok(p.includes("old stuff"));
    assert.ok(p.includes("Previous summary"));
  });

  it("formatSummaryBlock frames history, not instructions", () => {
    const b = formatSummaryBlock("did things");
    assert.ok(b.includes("did things"));
    assert.ok(b.includes("not new instructions"));
    assert.ok(b.includes("authoritative task state"));
  });
});

describe("summary validation", () => {
  it("accepts a complete summary and extracts the objective", () => {
    const check = validateCompactionSummary(makeSummary("Ship the parser"));
    assert.equal(check.valid, true);
    assert.equal(check.objective, "Ship the parser");
    assert.equal(check.missing.length, 0);
  });

  it("rejects a summary missing essential sections", () => {
    const check = validateCompactionSummary("## Objective\nShip it\n\nSome rambling prose.");
    assert.equal(check.valid, false);
    assert.ok(check.missing.includes("## Work State"));
    assert.ok(check.missing.includes("## Next Move"));
  });

  it("accepts a summary that inherits the objective from the previous one", () => {
    const previous = makeSummary("Original objective");
    const revised = makeSummary("Original objective").replace("## Objective\nOriginal objective", "## Objective\n");
    const check = validateCompactionSummary(revised, previous);
    assert.equal(check.valid, true);
    assert.equal(check.objective, "");
  });

  it("restores a dropped objective instead of losing user intent", () => {
    const previous = makeSummary("Original objective");
    const withoutObjective = makeSummary("ignored").replace(/## Objective\n[^\n]*\n\n/, "");
    const restored = ensureSummaryObjective(withoutObjective, previous);
    assert.equal(extractSummarySection(restored, "## Objective"), "Original objective");
  });

  it("caps an oversized summary", () => {
    const capped = capSummary("x".repeat(10_000), 1_000);
    assert.ok(capped.length < 1_200);
    assert.ok(capped.includes("Summary truncated"));
  });
});

describe("isContextOverflowError", () => {
  it("matches provider overflow phrasing", () => {
    assert.equal(isContextOverflowError(new Error("This model's maximum context length is 128000 tokens")), true);
    assert.equal(isContextOverflowError("input tokens exceed the context window"), true);
    assert.equal(isContextOverflowError("prompt is too long, reduce input"), true);
    assert.equal(isContextOverflowError("context_window_exceeded"), true);
  });

  it("rejects unrelated errors", () => {
    assert.equal(isContextOverflowError(new Error("rate limit exceeded, 429")), false);
    assert.equal(isContextOverflowError(new Error("fetch failed: ECONNREFUSED")), false);
    assert.equal(isContextOverflowError("An error occurred"), false);
  });
});

describe("checkpoint persistence", () => {
  it("saves, loads, and clears per thread", async () => {
    const tid = `t_${Date.now()}`;
    assert.equal(await loadCompaction(tid), null);
    await saveCompaction({
      threadId: tid,
      summary: "## Objective\ntest",
      anchor: "abc123",
      tokensBefore: 99999,
      count: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const rec = await loadCompaction(tid);
    assert.ok(rec);
    assert.equal(rec.summary, "## Objective\ntest");
    assert.equal(rec.count, 1);
    await clearCompaction(tid);
    assert.equal(await loadCompaction(tid), null);
  });
});

describe("maybeCompactMessages", () => {
  it("passes small histories through untouched", async () => {
    const msgs = [user("hi"), assistant("hello! how can I help?"), user("thanks")];
    const res = await maybeCompactMessages({
      messages: msgs,
      threadId: `pass_${Date.now()}`,
      systemPrompt: "sys",
    });
    assert.equal(res.compacted, false);
    assert.equal(res.freshSummary, false);
    assert.equal(res.summaryBlock, "");
    assert.equal(res.messages.length, msgs.length);
  });

  it("re-applies a stored checkpoint without calling an LLM", async () => {
    const tid = `reapply_${Date.now()}`;
    const msgs = [user("old one"), assistant("old answer"), user("recent question")];
    const anchor = anchorForMessage(msgs[2], 2000);
    await saveCompaction({
      threadId: tid,
      summary: "## Objective\nold work",
      anchor,
      tokensBefore: 50000,
      count: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const res = await maybeCompactMessages({ messages: msgs, threadId: tid, systemPrompt: "sys" });
    assert.equal(res.compacted, true);
    assert.equal(res.freshSummary, false);
    assert.equal(res.messages.length, 1);
    assert.ok(res.summaryBlock.includes("old work"));
    await clearCompaction(tid);
  });

  it("fails open when summarization has no model (keeps full history)", async () => {
    const saved: Record<string, string | undefined> = {
      QUBE_COMPACTION_CONTEXT_TOKENS: process.env.QUBE_COMPACTION_CONTEXT_TOKENS,
      QUBE_COMPACTION_RESERVE_TOKENS: process.env.QUBE_COMPACTION_RESERVE_TOKENS,
      QUBE_COMPACTION_KEEP_RECENT_TOKENS: process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS,
    };
    process.env.QUBE_COMPACTION_CONTEXT_TOKENS = "120";
    process.env.QUBE_COMPACTION_RESERVE_TOKENS = "20";
    process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = "100";
    try {
      const cfg = getCompactionConfig();
      assert.equal(cfg.contextTokens - cfg.reserveTokens, 100);
      const msgs = [bigUser(1, 2000), assistant("answer"), bigUser(2, 2000)];
      const res = await maybeCompactMessages({
        messages: msgs,
        threadId: `failopen_${Date.now()}`,
        systemPrompt: "sys",
      });
      // No provider is configured in the isolated test dir, so the summary
      // LLM call must fail — and compaction must fail open, not throw.
      assert.equal(res.freshSummary, false);
      assert.equal(res.failed, true);
      assert.equal(res.messages.length, msgs.length);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("compaction under repeated pressure", () => {
  const savedKeep = process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS;
  const restoreKeep = () => {
    if (savedKeep === undefined) delete process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS;
    else process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = savedKeep;
  };

  it("updates one anchored summary across repeated compactions", async () => {
    process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = "3000";
    const tid = `repeat_${Date.now()}`;
    try {
      const turns: UiMessage[] = [];
      for (let i = 0; i < 8; i++) {
        turns.push(bigUser(i, 4000), assistant(`answer ${i} ${"y".repeat(4000)}`));
      }
      let calls = 0;
      const seenPrevious: Array<string | undefined> = [];
      const summarize: SummaryFn = async ({ previousSummary }) => {
        calls += 1;
        seenPrevious.push(previousSummary);
        return makeSummary(`Ship objective ${calls}`);
      };

      const first = await maybeCompactMessages({
        messages: turns,
        threadId: tid,
        systemPrompt: "sys",
        force: true,
        summarize,
      });
      assert.equal(first.freshSummary, true);
      assert.equal(first.compacted, true);
      assert.ok(first.messages.length < turns.length);
      assert.ok(first.summaryBlock.includes("Ship objective 1"));
      assert.equal(first.stats.keptMessages, first.messages.length);

      // Next turns: the client resends the full history. The stored anchor
      // re-applies the checkpoint with no second LLM call.
      const next = [
        ...turns,
        bigUser(101), assistant(`next answer 1 ${"z".repeat(4000)}`),
        bigUser(102), assistant(`next answer 2 ${"z".repeat(4000)}`),
        bigUser(103), assistant(`next answer 3 ${"z".repeat(4000)}`),
      ];
      const steady = await maybeCompactMessages({ messages: next, threadId: tid, systemPrompt: "sys", summarize });
      assert.equal(steady.freshSummary, false);
      assert.equal(steady.compacted, true);
      assert.ok(steady.summaryBlock.includes("Ship objective 1"));
      assert.equal(calls, 1);

      // Forced compaction under new pressure produces a fresh summary,
      // iterating from the previous one rather than stacking summaries.
      const third = await maybeCompactMessages({
        messages: next,
        threadId: tid,
        systemPrompt: "sys",
        force: true,
        summarize,
      });
      assert.equal(third.freshSummary, true);
      assert.equal(calls, 2);
      assert.ok(seenPrevious[1]?.includes("Ship objective 1"));
      assert.ok(third.summaryBlock.includes("Ship objective 2"));
      assert.ok(!third.summaryBlock.includes("Ship objective 1"));

      const rec = await loadCompaction(tid);
      assert.equal(rec!.count, 2);
      assert.equal(rec!.objective, "Ship objective 2");
      await clearCompaction(tid);
    } finally {
      restoreKeep();
    }
  });

  it("survives twelve consecutive compaction cycles with one evolving summary", async () => {
    process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = "3000";
    const tid = `many_${Date.now()}`;
    try {
      const history: UiMessage[] = [];
      for (let i = 0; i < 24; i++) {
        history.push(bigUser(i, 4000), assistant(`answer ${i} ${"y".repeat(4000)}`));
      }
      for (let cycle = 1; cycle <= 12; cycle++) {
        history.push(bigUser(1000 + cycle, 4000), assistant(`cycle ${cycle} ${"z".repeat(4000)}`));
        let seenPrevious: string | undefined;
        const res = await maybeCompactMessages({
          messages: history,
          threadId: tid,
          systemPrompt: "sys",
          force: true,
          summarize: async ({ previousSummary }) => {
            seenPrevious = previousSummary;
            return makeSummary(`Objective cycle ${cycle}`);
          },
        });
        assert.equal(res.freshSummary, true, `cycle ${cycle} should summarize`);
        assert.ok(res.messages.length < history.length);
        assert.ok(res.summaryBlock.includes(`Objective cycle ${cycle}`));
        if (cycle > 1) assert.ok(seenPrevious?.includes(`Objective cycle ${cycle - 1}`));
      }
      const rec = await loadCompaction(tid);
      assert.ok(rec);
      assert.equal(rec!.count, 12);
      assert.equal(rec!.objective, "Objective cycle 12");
      assert.ok(rec!.summary.length <= 24_000);
      await clearCompaction(tid);
    } finally {
      restoreKeep();
    }
  });

  it("retries once when the summarizer drops required sections", async () => {
    process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = "3000";
    const tid = `retry_${Date.now()}`;
    try {
      const msgs = [
        bigUser(1, 4000), assistant("a"),
        bigUser(2, 4000), assistant("b"),
        bigUser(3, 4000), assistant("c"),
        user("latest"),
      ];
      let calls = 0;
      const summarize: SummaryFn = async () => {
        calls += 1;
        return calls === 1 ? "## Objective\nOnly the goal" : makeSummary("Recovered objective");
      };
      const res = await maybeCompactMessages({ messages: msgs, threadId: tid, systemPrompt: "sys", force: true, summarize });
      assert.equal(calls, 2);
      assert.equal(res.freshSummary, true);
      assert.equal(res.stats.summaryValidated, true);
      assert.ok(res.summaryBlock.includes("Recovered objective"));
      await clearCompaction(tid);
    } finally {
      restoreKeep();
    }
  });

  it("counts tool schemas against the trigger budget", async () => {
    process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = "3000";
    const tid = `tools_${Date.now()}`;
    try {
      const msgs = [bigUser(1, 4000), assistant("a"), bigUser(2, 4000), assistant("b"), user("latest")];
      const tools = {
        heavy_tool: {
          description: "d".repeat(8000),
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      };
      const res = await maybeCompactMessages({
        messages: msgs,
        threadId: tid,
        systemPrompt: "sys",
        tools,
        force: true,
        summarize: async () => makeSummary("tool accounting"),
      });
      assert.ok((res.stats.toolTokens || 0) > 1_500);
      assert.ok(res.stats.estimatedTotalTokens >= res.stats.toolTokens!);
      await clearCompaction(tid);
    } finally {
      restoreKeep();
    }
  });

  it("falls back to a deterministic hard cut when summarization fails", async () => {
    process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = "3000";
    const tid = `hardcut_${Date.now()}`;
    try {
      const msgs: UiMessage[] = [];
      for (let i = 0; i < 6; i++) msgs.push(bigUser(i, 4000), assistant(`answer ${i}`));
      const res = await maybeCompactMessages({
        messages: msgs,
        threadId: tid,
        systemPrompt: "sys",
        aggressive: true,
        force: true,
        summarize: async () => {
          throw new Error("summarizer unavailable");
        },
      });
      assert.equal(res.hardCut, true);
      assert.equal(res.compacted, true);
      assert.ok(res.messages.length < msgs.length);
      assert.ok(res.summaryBlock.includes("automatic summary unavailable"));
      assert.equal(res.stats.summaryValidated, false);
      const rec = await loadCompaction(tid);
      assert.ok(rec);
      assert.equal(rec!.count, 1);
      await clearCompaction(tid);
    } finally {
      restoreKeep();
    }
  });
});

describe("getCompactionConfig", () => {
  it("reads env overrides", () => {
    const prev = process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS;
    process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = "7777";
    try {
      assert.equal(getCompactionConfig().keepRecentTokens, 7777);
    } finally {
      if (prev === undefined) delete process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS;
      else process.env.QUBE_COMPACTION_KEEP_RECENT_TOKENS = prev;
    }
  });
});

describe("compaction notice (frontend tracking)", () => {
  it("parses the harness data-compaction payload", () => {
    const info = parseCompactionData({
      compacted: true,
      freshSummary: true,
      hardCut: false,
      retried: false,
      keptMessages: 4,
      droppedMessages: 20,
    });
    assert.ok(info);
    assert.equal(info.compacted, true);
    assert.equal(info.keptMessages, 4);
    assert.equal(info.droppedMessages, 20);
  });

  it("rejects non-compaction payloads", () => {
    assert.equal(parseCompactionData(null), null);
    assert.equal(parseCompactionData("x"), null);
    assert.equal(parseCompactionData({ compacted: false }), null);
    assert.equal(parseCompactionData({ other: 1 }), null);
  });

  it("sanitizes counts", () => {
    const info = parseCompactionData({ compacted: true, keptMessages: NaN, droppedMessages: -3 });
    assert.ok(info);
    assert.equal(info.keptMessages, undefined);
    assert.equal(info.droppedMessages, undefined);
  });

  it("formats fresh-summary, hard-cut, and retried notices", () => {
    const fresh = formatCompactionNotice(
      parseCompactionData({ compacted: true, freshSummary: true, keptMessages: 4, droppedMessages: 20 })!,
    );
    assert.ok(fresh.includes("20 older messages summarized"));
    assert.ok(fresh.includes("4 recent kept"));

    const cut = formatCompactionNotice(
      parseCompactionData({ compacted: true, freshSummary: true, hardCut: true, droppedMessages: 7 })!,
    );
    assert.ok(cut.includes("trimmed"));
    assert.ok(cut.includes("7 older messages dropped"));
    assert.ok(!cut.includes("summarized"));

    const retry = formatCompactionNotice(
      parseCompactionData({ compacted: true, freshSummary: true, retried: true })!,
    );
    assert.ok(retry.startsWith("Recovered from a full context"));
  });
});

before(() => {
  // Silence harness-adjacent logs during tests if any leak through.
});
