import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { convertVercelTool, flattenToolResult, vercelInputSchema } from "@/lib/pi/durable-tools";
import { installTurnCapabilities } from "@/lib/pi/durable-capabilities";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "t", callId: "c1" } as never;

describe("durable generic tool bridge", () => {
  it("resolves jsonSchema, Zod, and missing schemas", () => {
    assert.equal((vercelInputSchema({ inputSchema: { jsonSchema: { type: "object", properties: { a: {} } } }, execute: async () => 1 }) as { type?: string }).type, "object");
    const zodOut = vercelInputSchema({ inputSchema: z.object({ q: z.string() }), execute: async () => 1 }) as { properties?: Record<string, unknown> };
    assert.ok(zodOut.properties?.q);
    assert.deepEqual(vercelInputSchema({ execute: async () => 1 }), { type: "object", additionalProperties: true });
  });

  it("converts and delegates with call id", async () => {
    const tool = convertVercelTool("my_tool", {
      description: "Does a thing",
      inputSchema: z.object({ x: z.number() }),
      execute: async (args, opts) => {
        assert.deepEqual(args, { x: 1 });
        assert.equal((opts as { toolCallId: string }).toolCallId, "c1");
        return "done";
      },
    });
    const out = await tool.execute({ x: 1 } as never, fakeApi, BACKGROUND_CONTEXT);
    assert.equal((out as { output: Array<{ text: string }> }).output[0].text, "done");
  });

  it("flattens content arrays", () => {
    assert.equal(flattenToolResult({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "a\nb");
    assert.equal(flattenToolResult("plain"), "plain");
  });
});

describe("durable turn capabilities", () => {
  function fakeRegistry() {
    const installed: string[] = [];
    return { installed, install: (ext: unknown) => installed.push((ext as { name: string }).name) };
  }

  it("installs connector + mcp tools and cleans up", async () => {
    const registry = fakeRegistry();
    let cleaned = 0;
    const installed = await installTurnCapabilities(registry as never, {
      connectors: async () => ({ tools: { gmail_search: { execute: async () => "ok" } } }),
      mcp: async () => ({
        tools: { browser_navigate: { execute: async () => "ok" } },
        cleanup: async () => { cleaned++; },
      }),
    });
    assert.deepEqual(installed.installed.sort(), ["connectors", "mcp-turn"]);
    await installed.cleanup();
    assert.equal(cleaned, 1);
  });

  it("isolates loader failures", async () => {
    const registry = fakeRegistry();
    const installed = await installTurnCapabilities(registry as never, {
      mcp: async () => { throw new Error("boom"); },
      connectors: async () => ({ tools: { gmail_search: { execute: async () => "ok" } } }),
    });
    assert.deepEqual(installed.installed, ["connectors"]);
    assert.equal(installed.errors[0]?.source, "mcp");
  });

  it("skips empty tool sets", async () => {
    const registry = fakeRegistry();
    const installed = await installTurnCapabilities(registry as never, {
      connectors: async () => ({ tools: {} }),
    });
    assert.deepEqual(installed.installed, []);
  });
});
