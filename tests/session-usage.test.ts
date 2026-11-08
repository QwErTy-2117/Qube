import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-usage-test-"));
const dataDir = process.env.QUBE_DATA_DIR!;
mkdirSync(join(dataDir, ".memory", "observability"), { recursive: true });
writeFileSync(
  join(dataDir, ".memory", "providers.json"),
  JSON.stringify({
    defaultModelId: "openrouter:paid/model",
    providers: [
      {
        id: "openrouter",
        name: "OpenRouter",
        enabled: true,
        hasApiKey: true,
        models: [
          {
            id: "openrouter:paid/model",
            name: "paid/model",
            enabled: true,
            contextWindow: 200000,
            pricing: { input: 2, output: 8 },
          },
          {
            id: "openrouter:free/model",
            name: "free/model",
            enabled: true,
            contextWindow: 128000,
            pricing: { input: 0, output: 0 },
          },
          {
            id: "openrouter:unknown/model",
            name: "unknown/model",
            enabled: true,
          },
        ],
      },
    ],
  }),
  "utf-8",
);

function logThread(threadId: string, model: string) {
  const events = [
    {
      type: "model_usage",
      threadId,
      metadata: {
        promptTokens: 10_000,
        completionTokens: 2_000,
        totalTokens: 12_000,
        model,
      },
    },
    {
      type: "context_budget",
      threadId,
      metadata: { estimatedTokens: 12_000, contextWindow: 200_000 },
    },
  ];
  writeFileSync(
    join(dataDir, ".memory", "observability", `${threadId}.jsonl`),
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf-8",
  );
}

describe("session usage", () => {
  it("reports remaining context and real list-price cost when pricing exists", async () => {
    logThread("thread_paid", "openrouter:paid/model");
    const { getSessionUsage } = await import("@/lib/agent/session-usage");
    const usage = await getSessionUsage("thread_paid", "openrouter:paid/model");
    assert.equal(usage.contextWindow, 200_000);
    assert.equal(usage.remainingTokens, 188_000);
    assert.ok(Math.abs((usage.costUsd ?? 0) - 0.036) < 1e-9);
  });

  it("shows context but no cost for free or unpriced models", async () => {
    logThread("thread_free", "openrouter:free/model");
    const { getSessionUsage } = await import("@/lib/agent/session-usage");
    const free = await getSessionUsage("thread_free", "openrouter:free/model");
    assert.equal(free.costUsd, null);
    assert.ok(free.remainingTokens > 0);

    logThread("thread_unknown", "openrouter:unknown/model");
    const unknown = await getSessionUsage("thread_unknown", "openrouter:unknown/model");
    assert.equal(unknown.costUsd, null);
    assert.ok(unknown.remainingTokens > 0);
  });
});
