import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { buildConnectorsExtension, connectorJsonSchema, convertConnectorTool } from "@/lib/pi/durable-connectors";
import { isSensitiveDurableTool } from "@/lib/pi/durable-guard";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "test-task-conn", callId: "call-1" } as never;

describe("durable connectors bridge", () => {
  it("converts a Zod input schema to JSON Schema", () => {
    const json = connectorJsonSchema(z.object({ query: z.string(), topK: z.number().optional() }));
    assert.equal((json as { type?: string }).type, "object");
    assert.ok((json as { properties?: Record<string, unknown> }).properties?.query);
    assert.equal((json as { $schema?: unknown }).$schema, undefined);
  });

  it("falls back to permissive object for unknown schemas", () => {
    assert.deepEqual(connectorJsonSchema(undefined), { type: "object", additionalProperties: true });
    assert.deepEqual(connectorJsonSchema({ weird: true }), { type: "object", additionalProperties: true });
  });

  it("delegates execution and flattens results", async () => {
    const tool = convertConnectorTool("gmail_search", {
      description: "Search Gmail",
      inputSchema: z.object({ query: z.string() }),
      execute: async (args, opts) => {
        assert.deepEqual(args, { query: "from:ana" });
        assert.equal((opts as { toolCallId: string }).toolCallId, "call-1");
        return { content: [{ type: "text", text: "3 threads" }] };
      },
    });
    const out = await tool.execute({ query: "from:ana" } as never, fakeApi, BACKGROUND_CONTEXT);
    assert.equal((out as { output: Array<{ text: string }> }).output[0].text, "3 threads");
  });

  it("builds the connectors extension", () => {
    const ext = buildConnectorsExtension({ gmail_search: { execute: async () => "ok" } }) as { name: string; tools: unknown[] };
    assert.equal(ext.name, "connectors");
    assert.equal(ext.tools.length, 1);
  });

  it("sensitivity classifier gates writes but not reads", () => {
    assert.equal(isSensitiveDurableTool("gmail_search"), false);
    assert.equal(isSensitiveDurableTool("gmail_send_email"), true);
  });

  it("installs converted connector tools through the registry option", async () => {
    const { buildDurableRegistry } = await import("@/lib/pi/durable-registry");
    const registry = await buildDurableRegistry({
      connectorTools: { gmail_search: { description: "Search", execute: async () => "ok" } },
    });
    assert.ok(registry);
  });
});
