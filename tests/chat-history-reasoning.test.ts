import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createQubeHistoryAdapter } from "@/lib/chat/history-adapter";
import { threadMessageToUIMessage } from "@/lib/chat/message-convert";

const originalFetch = globalThis.fetch;
let store: any;
let writes: any[];

function message(id: string, parts: any[], role = "assistant") {
  return { id, role, parts };
}

describe("reasoning survives a chat reload", () => {
  beforeEach(() => {
    writes = [];
    store = {
      version: 2,
      headId: "m1",
      messages: [
        {
          parentId: null,
          message: message("m1", [
            { type: "reasoning", text: "Checked the page first." },
            { type: "text", text: "The answer is 42." },
          ]),
        },
      ],
    };
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        store = body.repository;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ repository: structuredClone(store), title: "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("loads stored reasoning parts unchanged and persists new ones", async () => {
    const item = {
      initialize: async () => ({ remoteId: "thread-1" }),
      getState: () => ({ remoteId: "thread-1" }),
    };
    const adapter = createQubeHistoryAdapter(() => item);
    const fmt = adapter.withFormat?.(undefined as any);
    assert.ok(fmt);

    const loaded: any = await fmt.load();
    assert.equal(loaded.headId, "m1");
    assert.deepEqual(loaded.messages[0].message.parts, [
      { type: "reasoning", text: "Checked the page first." },
      { type: "text", text: "The answer is 42." },
    ]);

    await fmt.append({
      parentId: "m1",
      message: message("m2", [
        { type: "reasoning", text: "Second thought." },
        { type: "text", text: "Final answer." },
      ]),
    });

    const write = writes.at(-1);
    assert.ok(write);
    const saved = write.repository.messages.find((m: any) => m.message.id === "m2");
    assert.ok(saved);
    assert.deepEqual(saved.message.parts[0], { type: "reasoning", text: "Second thought." });
    assert.equal(saved.parentId, "m1");
  });

  it("converts legacy ThreadMessage reasoning content on read", () => {
    const rec = threadMessageToUIMessage({
      id: "legacy-1",
      role: "assistant",
      content: [
        { type: "reasoning", text: "Legacy thought." },
        { type: "text", text: "Legacy answer." },
      ],
    });
    assert.ok(rec);
    assert.deepEqual(rec.parts, [
      { type: "reasoning", text: "Legacy thought." },
      { type: "text", text: "Legacy answer." },
    ]);
  });
});
