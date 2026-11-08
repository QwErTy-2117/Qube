/**
 * Context-budget unit tests: model windows, reserve math, tool-schema
 * accounting, calibrated totals, model-message estimation and the ladder.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

process.env.QUBE_DATA_DIR = mkdtempSync(join(tmpdir(), "qube-budget-test-"));

import {
  buildShrinkLadder,
  clampCalibration,
  computeContextBudget,
  defaultReserveTokens,
  estimateModelMessagesTokens,
  estimateTokens,
  estimateToolDefinitionsTokens,
  loadContextCalibration,
  normalizeModelName,
  recordContextCalibration,
  resolveContextWindow,
} from "@/lib/pi/context-budget";

const ENV_KEYS = ["QUBE_COMPACTION_CONTEXT_TOKENS"] as const;

describe("resolveContextWindow", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("matches known models and provider prefixes", () => {
    assert.equal(resolveContextWindow("openai/gpt-4.1").tokens, 1_047_576);
    assert.equal(resolveContextWindow("anthropic/claude-sonnet-4").tokens, 200_000);
    assert.equal(resolveContextWindow("gemini-2.5-pro").tokens, 1_048_576);
    assert.equal(resolveContextWindow("deepseek-chat").tokens, 128_000);
  });

  it("falls back to 128k for unknown models", () => {
    const res = resolveContextWindow("some-local-model");
    assert.equal(res.tokens, 128_000);
    assert.equal(res.source, "default");
  });

  it("lets an explicit env override win", () => {
    process.env.QUBE_COMPACTION_CONTEXT_TOKENS = "32768";
    const res = resolveContextWindow("gpt-4.1");
    assert.equal(res.tokens, 32_768);
    assert.equal(res.source, "env");
  });
});

describe("normalizeModelName", () => {
  it("strips provider and vendor prefixes", () => {
    assert.equal(normalizeModelName("openai/gpt-5"), "gpt-5");
    assert.equal(normalizeModelName("opencode:claude-sonnet-4"), "claude-sonnet-4");
    assert.equal(normalizeModelName("  GPT-4.1  "), "gpt-4.1");
  });
});

describe("reserve math", () => {
  it("is at least 16k, 15% of the window, and at most 40%", () => {
    assert.equal(defaultReserveTokens(32_768), 13_107);
    assert.equal(defaultReserveTokens(200_000), 30_000);
    assert.equal(defaultReserveTokens(500_000), 75_000);
    assert.equal(defaultReserveTokens(1_048_576), 157_287);
    assert.equal(defaultReserveTokens(1_000), 400);
  });
});

describe("estimateTokens", () => {
  it("keeps ASCII chars/4 and prices wide characters higher", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("日本語"), 2);
    assert.ok(estimateTokens("日本語") > estimateTokens("abc"));
  });
});

describe("tool-schema accounting", () => {
  it("counts names, descriptions and zod schemas", () => {
    const tools = {
      read_file: {
        description: "Read a file from disk",
        inputSchema: z.object({
          path: z.string().describe("workspace-relative path"),
          offset: z.number().optional(),
        }),
      },
      run_command: {
        description: "Run a shell command",
        inputSchema: z.object({ command: z.string(), cwd: z.string().optional() }),
      },
    };
    const est = estimateToolDefinitionsTokens(tools);
    assert.equal(est.count, 2);
    assert.ok(est.tokens > 0);
    assert.ok(est.serializedChars > 100);
    assert.deepEqual(est.estimatedOnly, []);
  });

  it("counts an empty tool set as zero", () => {
    const est = estimateToolDefinitionsTokens(undefined);
    assert.equal(est.tokens, 0);
    assert.equal(est.count, 0);
  });

  it("accepts AI-SDK jsonSchema wrappers", () => {
    const est = estimateToolDefinitionsTokens({
      mcp_tool: { description: "MCP", inputSchema: { jsonSchema: { type: "object", properties: { q: { type: "string" } } } } },
    });
    assert.ok(est.tokens > 0);
    assert.deepEqual(est.estimatedOnly, []);
  });
});

describe("computeContextBudget", () => {
  beforeEach(() => {
    delete process.env.QUBE_COMPACTION_CONTEXT_TOKENS;
  });

  it("sums system, tools, messages and summary with reserve headroom", () => {
    const budget = computeContextBudget({
      modelName: "gpt-4.1",
      systemPrompt: "x".repeat(4_000),
      toolTokens: 2_000,
      messageTokens: 10_000,
      summaryTokens: 1_000,
    });
    assert.equal(budget.systemTokens, 1_000);
    assert.equal(budget.toolTokens, 2_000);
    assert.equal(budget.messageTokens, 10_000);
    assert.equal(budget.summaryTokens, 1_000);
    assert.equal(budget.rawTotalTokens, 14_000);
    assert.equal(budget.totalTokens, 14_000);
    assert.equal(budget.thresholdTokens, 1_047_576 - budget.reserveTokens);
    assert.ok(budget.headroomTokens > 0);
  });

  it("applies the calibration factor and clamps absurd values", () => {
    const budget = computeContextBudget({ messageTokens: 10_000, calibrationFactor: 1.5 });
    assert.equal(budget.totalTokens, 15_000);

    const high = computeContextBudget({ messageTokens: 10_000, calibrationFactor: 99 });
    assert.equal(high.calibrationFactor, 3);
    assert.equal(high.totalTokens, 30_000);

    const low = computeContextBudget({ messageTokens: 10_000, calibrationFactor: 0.01 });
    assert.equal(low.calibrationFactor, 0.5);
    assert.equal(low.totalTokens, 5_000);
    assert.equal(clampCalibration(Number.NaN), 1);
  });

  it("honors an explicit reserve without exceeding 40%", () => {
    const b = computeContextBudget({ modelName: "deepseek-chat", messageTokens: 10, reserveTokens: 999_999 });
    assert.ok(b.reserveTokens <= 128_000 * 0.4);
  });
});

describe("estimateModelMessagesTokens", () => {
  it("counts text, tool calls and tool results", () => {
    const messages = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "working" },
          { type: "tool-call", toolName: "read_file", input: { path: "a.ts" } },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolName: "read_file", output: "x".repeat(4_000) }],
      },
    ];
    const withTools = estimateModelMessagesTokens(messages);
    const textOnly = estimateModelMessagesTokens([{ role: "user", content: "hello" }]);
    assert.ok(withTools > 1_000);
    assert.ok(withTools > textOnly);
  });

  it("handles string tool output and empty arrays", () => {
    assert.equal(estimateModelMessagesTokens([]), 0);
    const n = estimateModelMessagesTokens([
      { role: "tool", content: [{ type: "tool-result", output: "abcd" }] },
    ]);
    assert.ok(n >= 4);
  });
});

describe("provider calibration", () => {
  beforeEach(() => {
    delete process.env.QUBE_COMPACTION_CONTEXT_TOKENS;
  });

  it("starts at 1 and folds real usage into an EWMA", async () => {
    const thread = `cal_${Date.now()}`;
    assert.equal(await loadContextCalibration(thread), 1);

    const first = await recordContextCalibration(thread, 10_000, 20_000);
    assert.ok(first > 1 && first < 2.1);

    const stored = await loadContextCalibration(thread);
    assert.ok(Math.abs(stored - first) < 0.001);

    const second = await recordContextCalibration(thread, 10_000, 10_000);
    assert.ok(second < stored);
  });

  it("ignores samples too small to be meaningful", async () => {
    const thread = `cal_small_${Date.now()}`;
    assert.equal(await recordContextCalibration(thread, 10, 5_000), 1);
    assert.equal(await recordContextCalibration(thread, 10_000, 10), 1);
    assert.equal(await recordContextCalibration(undefined, 10_000, 10_000), 1);
  });
});

describe("shrink ladder", () => {
  it("is strictly more aggressive", () => {
    const ladder = buildShrinkLadder(15_000);
    assert.deepEqual(ladder.map((s) => s.name), ["checkpoint", "aggressive-checkpoint", "hard-cut"]);
    assert.equal(ladder[0].keepRecentTokens, 15_000);
    assert.ok(ladder[1].keepRecentTokens < ladder[0].keepRecentTokens);
    assert.ok(ladder[2].keepRecentTokens < ladder[1].keepRecentTokens);
    assert.equal(ladder[2].summarize, false);
  });
});

afterEach(() => {
  delete process.env.QUBE_COMPACTION_CONTEXT_TOKENS;
});
