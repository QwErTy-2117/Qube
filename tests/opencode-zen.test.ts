import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateText } from "ai";
import { POST as listProviderModels } from "@/app/api/providers/models/route";
import { createPiModelClient } from "@/lib/pi/model-client";
import { providerStore } from "@/lib/pi/provider-store";

const expectedZenHeaders = {
  "x-opencode-client": "cli",
  "x-opencode-session": "ses_global_sync",
};

describe("OpenCode Zen client headers", () => {
  it("sends client headers when listing Zen models", async () => {
    const originalFetch = globalThis.fetch;
    let outgoing: Headers | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      outgoing = new Headers(init?.headers);
      return Response.json({ data: [{ id: "free-model" }] });
    }) as typeof fetch;

    try {
      const response = await listProviderModels(new Request("http://localhost/api/providers/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "opencode",
          baseURL: "https://opencode.ai/zen/v1",
          apiKey: "zen-test-key",
        }),
      }));
      assert.equal(response.status, 200);
      assert.equal(outgoing?.get("authorization"), "Bearer zen-test-key");
      for (const [name, value] of Object.entries(expectedZenHeaders)) {
        assert.equal(outgoing?.get(name), value);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends client headers on the agent's chat-completions request", async () => {
    const originalFetch = globalThis.fetch;
    let outgoing: Headers | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      outgoing = new Headers(init?.headers);
      return Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "free-model",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch;

    providerStore.sync([{
      id: "opencode",
      name: "OpenCode Zen",
      baseURL: "https://opencode.ai/zen/v1",
      enabled: true,
      hasApiKey: true,
      apiKey: "zen-test-key",
      models: [{ id: "free-model", name: "Free model", enabled: true }],
    }]);

    try {
      const model = createPiModelClient("opencode:free-model");
      await generateText({ model, prompt: "Reply with ok", maxOutputTokens: 5 });
      assert.equal(outgoing?.get("authorization"), "Bearer zen-test-key");
      for (const [name, value] of Object.entries(expectedZenHeaders)) {
        assert.equal(outgoing?.get(name), value);
      }
    } finally {
      globalThis.fetch = originalFetch;
      providerStore.sync([]);
    }
  });
});
