import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { z } from "zod";

export type ConnectorTool = {
  description?: string;
  inputSchema?: unknown;
  execute: (args: unknown, opts?: unknown) => Promise<unknown>;
};

function isZodSchema(value: unknown): boolean {
  return !!value && typeof value === "object" && typeof (value as { safeParse?: unknown }).safeParse === "function";
}

/** Convert a Zod schema to JSON Schema for pi-ai Type.Unsafe; permissive fallback. */
export function connectorJsonSchema(schema: unknown): Record<string, unknown> {
  const permissive = { type: "object", additionalProperties: true };
  if (!schema) return permissive;
  const raw = schema as { jsonSchema?: Record<string, unknown> };
  if (raw.jsonSchema && typeof raw.jsonSchema === "object") return raw.jsonSchema;
  if (isZodSchema(schema)) {
    try {
      const json = z.toJSONSchema(schema as never, { io: "input" }) as Record<string, unknown>;
      delete (json as { $schema?: unknown }).$schema;
      return json;
    } catch {
      return permissive;
    }
  }
  return permissive;
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const parts = content
        .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
          ? String((p as { text: unknown }).text)
          : JSON.stringify(p)))
        .join("\n");
      if (parts) return parts;
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
  return String(result ?? "");
}

/**
 * Convert one Composio connector tool to a durable tool. Read-only
 * lookups stay free; sends/creates/deletes are gated by the guard
 * extension's sensitivity classifier. No replay: remote side effects.
 */
export function convertConnectorTool(name: string, tool: ConnectorTool) {
  return defineTool({
    name,
    description: (tool.description || name).slice(0, 1000),
    parameters: Type.Unsafe(connectorJsonSchema(tool.inputSchema)),
    execute: async (args, api) => {
      const out = await tool.execute(args, { toolCallId: api.callId });
      return { output: [{ type: "text", text: resultText(out).slice(0, 20000) }] as Array<{ type: "text"; text: string }> };
    },
  });
}

export function buildConnectorsExtension(tools: Record<string, ConnectorTool>) {
  const converted = Object.entries(tools).map(([name, tool]) => convertConnectorTool(name, tool));
  return defineExtension({ name: "connectors", tools: converted });
}
