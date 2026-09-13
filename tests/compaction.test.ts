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
  it("contains the structured sections", () => {
    const p = buildSummaryPrompt({});
    for (const h of ["## Objective", "## Requirements", "## Key Decisions", "## Progress", "## Next Steps", "## Critical Context"]) {
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
