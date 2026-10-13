import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDurableModels, resolveModelRef, resolveProviderModule, resolveThinkingLevel } from "@/lib/pi/durable-models";

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

  it("resolves ModelRefs with pi-ai provider ids", () => {
    assert.deepEqual(resolveModelRef("openai:gpt-4o-mini"), { provider: "openai", modelId: "gpt-4o-mini" });
    assert.deepEqual(resolveModelRef("bedrock:anthropic.claude-haiku"), { provider: "amazon-bedrock", modelId: "anthropic.claude-haiku" });
    assert.deepEqual(resolveModelRef("vertexai:gemini-2.5-flash"), { provider: "google-vertex", modelId: "gemini-2.5-flash" });
    assert.deepEqual(resolveModelRef("moonshot:kimi-k2"), { provider: "moonshotai", modelId: "kimi-k2" });
    assert.deepEqual(resolveModelRef("ollama:llama3.1"), { provider: "openai", modelId: "llama3.1" });
    assert.deepEqual(resolveModelRef("chatgpt:gpt-5-mini"), { provider: "openai", modelId: "gpt-5-mini" });
    assert.equal(resolveModelRef("nope:missing-1"), null);
    assert.equal(resolveModelRef("nocolon"), null);
  });

  it("maps reasoning effort to thinking level", () => {
    assert.equal(resolveThinkingLevel("high"), "high");
    assert.equal(resolveThinkingLevel("off"), "off");
    assert.equal(resolveThinkingLevel(undefined), "off");
    assert.equal(resolveThinkingLevel("bogus"), "off");
  });
});
