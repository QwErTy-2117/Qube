import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { z } from "zod";

/**
 * Generic bridge from Vercel AI SDK tool objects to durable tools.
 * Handles the three schema shapes Qube produces: a JSON Schema wrapper
 * ({ jsonSchema }), a Zod schema (Composio connectors), or nothing.
 */
export type VercelTool = {
  description?: string;
  /** Vercel AI SDK v6: Zod schema or { jsonSchema } wrapper. */
  inputSchema?: unknown;
  /** Legacy Vercel AI SDK: Zod schema. */
  parameters?: unknown;
  execute: (args: unknown, opts?: unknown) => Promise<unknown>;
};

function isZodSchema(value: unknown): boolean {
  return !!value && typeof value === "object" && typeof (value as { safeParse?: unknown }).safeParse === "function";
}

/** Resolve a Vercel tool's input schema to JSON Schema for Type.Unsafe. */
export function vercelInputSchema(tool: VercelTool): Record<string, unknown> {
  const permissive = { type: "object", additionalProperties: true };
  const schema = tool.inputSchema ?? tool.parameters;
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

/** Flatten a Vercel tool result (string, CallToolResult, or JSON) to text. */
export function flattenToolResult(result: unknown): string {
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
 * Convert one Vercel tool to a durable tool. Mutating tools omit replay
 * (a crash-interrupted call is reported to the model, never repeated);
 * pass `replay: "safe"` for tools known to be pure reads.
 */
export function convertVercelTool(name: string, tool: VercelTool, opts?: { replay?: "safe" }) {
  return defineTool({
    name,
    description: (tool.description || name).slice(0, 1000),
    parameters: Type.Unsafe(vercelInputSchema(tool)),
    ...(opts?.replay === "safe" ? { replay: "safe" as const } : {}),
    execute: async (args, api) => {
      const out = await tool.execute(args, { toolCallId: api.callId });
      return { output: [{ type: "text", text: flattenToolResult(out).slice(0, 20000) }] as Array<{ type: "text"; text: string }> };
    },
  });
}

export function buildVercelExtension(name: string, tools: Record<string, VercelTool>) {
  const converted = Object.entries(tools).map(([toolName, tool]) => convertVercelTool(toolName, tool));
  return defineExtension({ name, tools: converted });
}
