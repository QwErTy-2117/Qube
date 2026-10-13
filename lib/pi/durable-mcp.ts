import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

export type VercelMcpTool = {
  description?: string;
  inputSchema?: { jsonSchema?: Record<string, unknown> };
  execute: (args: unknown, opts?: unknown) => Promise<unknown>;
};

/** MCP tool names come from servers; keep them callable-safe. */
export function sanitizeMcpToolName(name: string): string {
  const clean = name.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "mcp_tool";
  return clean;
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
 * Convert one Vercel-format MCP tool to a durable tool. Unknown
 * server side effects mean no replay: a crash-interrupted call is
 * reported to the model, never repeated. Client lifecycle stays with
 * the caller (loadMcpTools / closeMcpClients).
 */
export function convertMcpTool(name: string, tool: VercelMcpTool, serverName: string) {
  const safeName = sanitizeMcpToolName(name);
  const schema = tool.inputSchema?.jsonSchema ?? { type: "object" };
  return defineTool({
    name: safeName,
    description: `MCP ${serverName}: ${tool.description || name}`.slice(0, 1000),
    parameters: Type.Unsafe(schema),
    execute: async (args, api) => {
      const out = await tool.execute(args, { toolCallId: api.callId });
      return { output: [{ type: "text", text: resultText(out).slice(0, 20000) }] as Array<{ type: "text"; text: string }> };
    },
  });
}

export function buildMcpExtension(tools: Record<string, VercelMcpTool>, serverName: string) {
  const converted = Object.entries(tools).map(([name, tool]) => convertMcpTool(name, tool, serverName));
  return defineExtension({ name: `mcp-${serverName}`, tools: converted });
}
