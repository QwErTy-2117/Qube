import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDurableModels, resolveProviderModule } from "@/lib/pi/durable-models";

const DEDICATED = [
  "openai:gpt-4o-mini",
  "anthropic:claude-haiku-4-5",
  "google:gemini-2.5-flash",
  "mistral:mistral-small-latest",
  "deepseek:deepseek-chat",
  "xai:grok-4-1-fast-non-reasoning",
  "groq:llama-3.3-70b-versatile",
  "together:meta-llama-3-1-8b",
  "openrouter:openai/gpt-4o-mini",
  "fireworks:llama-3.3-70b",
  "cerebras:llama-3.3-70b",
  "huggingface:meta-llama-3-8b",
  "moonshot:kimi-k2",
  "minimax:minimax-m2",
  "azure:gpt-4o-mini",
  "bedrock:anthropic.claude-haiku",
  "vertexai:gemini-2.5-flash",
  "nvidia:meta/llama-3.1-8b-instruct",
];

const FALLBACK = ["ollama:llama3.1", "lmstudio:local-model", "custom:my-model", "chatgpt:gpt-5-mini"];

describe("durable models adapter", () => {
  it("resolves a dedicated pi-ai factory per provider", () => {
    for (const id of ["openai", "anthropic", "deepseek", "bedrock", "vertexai", "moonshot"]) {
      assert.ok(resolveProviderModule(id), `expected module for ${id}`);
    }
    assert.equal(resolveProviderModule("ollama"), null);
    assert.equal(resolveProviderModule("nope"), null);
  });

  it("builds pi-ai models for every dedicated provider id without throwing", async () => {
    for (const id of DEDICATED) {
      const models = await buildDurableModels(id);
      assert.ok(models, id);
    }
  });

  it("falls back to OpenAI-compatible provider for the rest", async () => {
    for (const id of FALLBACK) {
      const models = await buildDurableModels(id);
      assert.ok(models, id);
    }
  });

  it("throws for unknown model", async () => {
    await assert.rejects(() => buildDurableModels("nope:missing-1"));
  });
});
