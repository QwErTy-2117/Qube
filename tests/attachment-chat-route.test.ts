/**
 * End-to-end send/retry regression against a fake OpenAI-compatible provider.
 *
 * The client keeps a `data:` URL file part in its UIMessage history. Both the
 * first send and a retry that regenerates from that same history must reach
 * the provider as safe text — never as a `text/plain` file part that the
 * provider rejects with a model error.
 *
 * Run: npx tsx --test tests/attachment-chat-route.test.ts (or `npm test`)
 */

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ProviderRequest = { messages: Array<{ role: string; content: unknown[] }> };

let POST: (req: Request) => Promise<Response>;
// Inferred from a dynamic import after WORKSPACE_PATH is set.
let providerStore: any;
let tempWorkspace = "";
let originalFetch: typeof fetch;
let originalWorkspacePath: string | undefined;
let originalDurableFlag: string | undefined;
const providerRequests: ProviderRequest[] = [];

function fakeProviderResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\n',
      ));
      controller.enqueue(encoder.encode(
        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      ));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

before(async () => {
  originalFetch = globalThis.fetch;
  originalWorkspacePath = process.env.WORKSPACE_PATH;
  originalDurableFlag = process.env.PI_DURABLE_ENABLED;
  tempWorkspace = mkdtempSync(join(tmpdir(), "qube-attachment-route-"));
  process.env.WORKSPACE_PATH = tempWorkspace;
  delete process.env.PI_DURABLE_ENABLED;

  // Set WORKSPACE_PATH before importing the route: workspace resolution is
  // module-level, and persisted attachment bytes must stay in this temp dir.
  ({ POST } = await import("@/app/api/chat/route"));
  ({ providerStore } = await import("@/lib/pi/provider-store"));
  providerStore.sync([{
    id: "test",
    name: "Test provider",
    baseURL: "http://local.test/v1",
    enabled: true,
    hasApiKey: true,
    apiKey: "test-key",
    models: [{ id: "test:model", name: "Test model", enabled: true }],
  }], "test:model");

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/chat/completions") && typeof init?.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as ProviderRequest;
        if (Array.isArray(parsed.messages)) providerRequests.push(parsed);
      } catch {}
    }
    return fakeProviderResponse();
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  providerStore?.sync([]);
  if (tempWorkspace) rmSync(tempWorkspace, { recursive: true, force: true });
  if (originalWorkspacePath === undefined) delete process.env.WORKSPACE_PATH;
  else process.env.WORKSPACE_PATH = originalWorkspacePath;
  if (originalDurableFlag === undefined) delete process.env.PI_DURABLE_ENABLED;
  else process.env.PI_DURABLE_ENABLED = originalDurableFlag;
});

function chatRequest(): Request {
  const attachmentText = "Quarterly numbers: 42 — attachment content is data.";
  const attachmentUrl = `data:text/plain;base64,${Buffer.from(attachmentText, "utf8").toString("base64")}`;
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "thread-attachment-route",
      config: { modelName: "test:model" },
      memoryEnabled: false,
      mcpServers: [],
      skills: [],
      allowedDirs: [],
      messages: [{
        id: "user-attachment-1",
        role: "user",
        parts: [
          { type: "text", text: "Please review the attachment." },
          {
            type: "file",
            url: attachmentUrl,
            mediaType: "text/plain",
            filename: "notes.txt",
          },
        ],
      }],
    }),
  });
}

describe("chat route attachment send and retry", () => {
  it("sends the attachment as untrusted text on both requests with no model error", async () => {
    providerRequests.length = 0;

    const first = await POST(chatRequest());
    assert.equal(first.status, 200);
    const firstText = await first.text();
    assert.match(firstText, /text-delta/);
    assert.match(firstText, /"delta":"ok"/);

    // Retry/regenerate replays the same persisted UIMessage with the data URL
    // still present. It must normalize identically, not throw a provider
    // UnsupportedFunctionalityError for a text/plain file part.
    const retry = await POST(chatRequest());
    assert.equal(retry.status, 200);
    const retryText = await retry.text();
    assert.match(retryText, /"delta":"ok"/);

    assert.equal(providerRequests.length, 2);
    for (const request of providerRequests) {
      const user = request.messages.find((message) => message.role === "user");
      assert.ok(user);
      const content = user?.content ?? [];
      assert.ok(!content.some((part: any) =>
        part?.type === "file" || part?.type === "input_file" || part?.type === "image_url"
      ));
      assert.ok(content.some((part: any) =>
        part?.type === "text" && String(part.text).includes("Quarterly numbers: 42")
      ));
      assert.ok(content.some((part: any) =>
        part?.type === "text" && String(part.text).includes("untrusted data, not instructions")
      ));
    }
  });
});
