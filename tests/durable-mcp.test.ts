import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMcpExtension, convertMcpTool, sanitizeMcpToolName } from "@/lib/pi/durable-mcp";
import { buildDurableRegistry } from "@/lib/pi/durable-registry";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "test-task-mcp", callId: "call-1" } as never;

describe("durable mcp bridge", () => {
  it("sanitizes server tool names", () => {
    assert.equal(sanitizeMcpToolName("browser_navigate"), "browser_navigate");
    assert.equal(sanitizeMcpToolName("my tool@v2"), "my_tool_v2");
  });

  it("delegates execution and stringifies CallToolResult content", async () => {
    const vercel = {
      description: "Navigate",
      inputSchema: { jsonSchema: { type: "object", properties: { url: { type: "string" } } } },
      execute: async (args: unknown, opts: unknown) => {
        assert.deepEqual(args, { url: "https://example.com" });
        assert.equal((opts as { toolCallId: string }).toolCallId, "call-1");
        return { content: [{ type: "text", text: "navigated" }] };
      },
    };
    const tool = convertMcpTool("browser_navigate", vercel, "browser");
    const out = await tool.execute({ url: "https://example.com" } as never, fakeApi, BACKGROUND_CONTEXT);
    assert.equal((out as { output: Array<{ text: string }> }).output[0].text, "navigated");
  });

  it("propagates inner throws as model error results", async () => {
    const vercel = {
      description: "Boom",
      execute: async () => { throw new Error("socket gone"); },
    };
    const tool = convertMcpTool("boom", vercel, "test");
    await assert.rejects(tool.execute({} as never, fakeApi, BACKGROUND_CONTEXT), /socket gone/);
  });

  it("builds one extension per server", () => {
    const ext = buildMcpExtension(
      { a: { execute: async () => "ok" } },
      "myserver",
    ) as { name: string; tools: unknown[] };
    assert.equal(ext.name, "mcp-myserver");
    assert.equal(ext.tools.length, 1);
  });

  it("installs converted tools through the registry option", async () => {
    const registry = await buildDurableRegistry({
      mcpTools: { ping: { description: "Ping", execute: async () => "pong" } },
      mcpServerName: "test",
    });
    assert.ok(registry);
  });
});
