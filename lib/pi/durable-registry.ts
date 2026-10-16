import { Type } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { recallMemory, rememberMemory, READ_MEMORY_DESCRIPTION, SAVE_MEMORY_DESCRIPTION, isMemoryEnabled } from "@/lib/memory/tools-core";

const CATEGORY_VALUES = ["personal", "preference", "project", "technology", "decision", "pattern", "constraint", "goal", "general"] as const;

export const readMemoryTool = defineTool({
  name: "read_memory",
  description: READ_MEMORY_DESCRIPTION,
  parameters: Type.Object({
    query: Type.Optional(Type.String({ description: "What to recall, e.g. 'user name and preferences' (empty returns priority memories)" })),
    scopeKey: Type.Optional(Type.String({ description: "Project/workspace key to prefer scoped memories" })),
    memoryType: Type.Optional(Type.String({ description: "Narrow by memory type" })),
    scope: Type.Optional(Type.String({ description: "Narrow by scope (global_user, project, workspace, ...)" })),
  }),
  replay: "safe",
  execute: async (args) => {
    const res = await recallMemory(
      { query: (args as { query?: string }).query || "", scope: (args as { scope?: string }).scope, scopeKey: (args as { scopeKey?: string }).scopeKey, memoryType: (args as { memoryType?: string }).memoryType, topK: 8 },
      {},
    );
    return { output: [{ type: "text", text: JSON.stringify(res) }] as const };
  },
});

export const saveMemoryTool = defineTool({
  name: "save_memory",
  description: SAVE_MEMORY_DESCRIPTION,
  parameters: Type.Object({
    category: Type.Union(CATEGORY_VALUES.map((c) => Type.Literal(c))),
    content: Type.String({ description: "One concise, preferably generalized fact to remember" }),
    relevance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    scope: Type.Optional(Type.String()),
    scopeKey: Type.Optional(Type.String()),
    memoryType: Type.Optional(Type.String()),
  }),
  execute: async (args, api) => {
    const taskId = String((api as unknown as { taskId?: unknown }).taskId ?? "durable");
    const res = await rememberMemory(args as { category: string; content: string; relevance?: number; confidence?: number; scope?: string; scopeKey?: string; memoryType?: string }, { threadId: taskId, provenance: `tool:${taskId}` });
    return { output: [{ type: "text", text: JSON.stringify(res) }] as const };
  },
});

/**
 * Query-independent memory section (core profile + index map). Stable across
 * turns for prompt-cache friendliness; per-query recall goes through
 * read_memory. Returns undefined when memory is disabled or empty.
 */
export function buildMemorySection() {
  return section("memory", async () => {
    try {
      if (!isMemoryEnabled()) return undefined;
      const { buildMemoryBrief } = await import("@/lib/memory/brief");
      // No query here: section render has no access to the pending user
      // message, so render core + map only (recall stays in the tool).
      const brief = await buildMemoryBrief({});
      return brief || undefined;
    } catch {
      return undefined;
    }
  });
}

export async function buildDurableRegistry(opts?: {
  userName?: string;
  userAbout?: string;
  mcpTools?: Record<string, import("@/lib/pi/durable-mcp").VercelMcpTool>;
  mcpServerName?: string;
  connectorTools?: Record<string, import("@/lib/pi/durable-connectors").ConnectorTool>;
}) {
  const registry = createRegistry();
  const { buildQubeExtension } = await import("@/lib/pi/durable-prompt");
  registry.install(buildQubeExtension(opts));
  const { buildFilesExtension } = await import("@/lib/pi/durable-files");
  registry.install(buildFilesExtension());
  registry.install(defineExtension({ name: "memory", tools: [readMemoryTool, saveMemoryTool], sections: [buildMemorySection()] }));
  const { buildGoalsExtension, buildNotesExtension } = await import("@/lib/pi/durable-goals");
  registry.install(buildGoalsExtension());
  registry.install(buildNotesExtension());
  const { buildWebExtension } = await import("@/lib/pi/durable-web");
  registry.install(buildWebExtension());
  const { buildShellExtension } = await import("@/lib/pi/durable-shell");
  registry.install(buildShellExtension());
  const { buildBrowserExtension } = await import("@/lib/pi/durable-browser");
  registry.install(buildBrowserExtension());
  const { buildSubagentsExtension } = await import("@/lib/pi/durable-subagents");
  registry.install(buildSubagentsExtension());
  const { buildSchedulerExtension } = await import("@/lib/pi/durable-scheduler");
  registry.install(buildSchedulerExtension());
  const { buildAskExtension } = await import("@/lib/pi/durable-ask");
  registry.install(buildAskExtension());
  const { buildGuardExtension } = await import("@/lib/pi/durable-guard");
  registry.install(buildGuardExtension());
  // MCP tools are caller-loaded (loadMcpTools owns client lifecycle);
  // the bridge converts them without connecting anything itself.
  if (opts?.mcpTools && Object.keys(opts.mcpTools).length > 0) {
    const { buildMcpExtension } = await import("@/lib/pi/durable-mcp");
    registry.install(buildMcpExtension(opts.mcpTools, opts.mcpServerName || "custom"));
  }
  // Connector tools are caller-loaded (loadConnectorTools owns the
  // Composio session); sensitive sends/creates/deletes are gated by
  // the guard hook above.
  if (opts?.connectorTools && Object.keys(opts.connectorTools).length > 0) {
    const { buildConnectorsExtension } = await import("@/lib/pi/durable-connectors");
    registry.install(buildConnectorsExtension(opts.connectorTools));
  }
  return registry;
}

export function approvalMemoKey(tool: string, argsHash: string): string {
  return `approval:${tool}:${argsHash}`;
}
