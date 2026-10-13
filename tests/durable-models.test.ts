import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDurableModels } from "@/lib/pi/durable-models";

describe("durable models adapter", () => {
  it("builds pi-ai models for openai id without throwing", async () => {
    const models = await buildDurableModels("openai:gpt-4o-mini");
    assert.ok(models);
  });
  it("throws for unknown model", async () => {
    await assert.rejects(() => buildDurableModels("nope:missing-1"));
  });
});
