import { Type } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";

const CATEGORY_VALUES = ["personal", "preference", "project", "technology", "decision", "pattern", "constraint", "goal", "general"] as const;

export const readMemoryTool = defineTool({
  name: "read_memory",
  description:
    "Recall persistent memory across ALL chats and sessions (factual + persona). " +
    "Call with a short query describing what you need. Returns the most relevant memories (bounded top-K, relevance-ranked). " +
    "Check memory before asking clarifying questions whenever the task touches identity, preferences, projects, or decisions.",
  parameters: Type.Object({
    query: Type.String({ description: "What to recall, e.g. 'user name and preferences'" }),
    scopeKey: Type.Optional(Type.String({ description: "Project/workspace key to prefer scoped memories" })),
    memoryType: Type.Optional(Type.String({ description: "Narrow by memory type" })),
    scope: Type.Optional(Type.String({ description: "Narrow by scope (global_user, project, workspace, ...)" })),
  }),
  replay: "safe",
  execute: async (args) => {
    try {
      const { searchMemories } = await import("@/lib/memory/memory-store");
      const entries = await searchMemories({
        query: args.query,
        scope: args.scope,
        scopeKey: args.scopeKey,
        memoryType: args.memoryType,
        topK: 8,
      });
      const text = entries.length === 0
        ? JSON.stringify({ entries: [], message: "No relevant memories stored yet." })
        : JSON.stringify({
          entries: entries.map((e) => ({
            id: e.id, category: e.category, content: e.content,
            confidence: e.confidence, scope: e.scope || "global_user",
            memoryType: e.memoryType || "context",
          })),
        });
      return { output: [{ type: "text", text }] as const };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: [{ type: "text", text: JSON.stringify({ error: msg }) }] as const };
    }
  },
});

export const saveMemoryTool = defineTool({
  name: "save_memory",
  description:
    "Save a durable memory across ALL chats and sessions. Use for: user name, preferences, project facts, decisions, constraints, goals. " +
    "One concise fact per call; generalize to a reusable principle. Do NOT store secrets, passwords, or tokens (blocked). " +
    "Do NOT store ephemeral one-offs. (Never auto-replayed after a crash.)",
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
    try {
      const { checkPersistable } = await import("@/lib/memory/safety");
      const gate = checkPersistable(args.content);
      if (!gate.ok) return { output: [{ type: "text", text: JSON.stringify({ error: gate.reason, saved: false }) }] as const };
      const { generalizeContent } = await import("@/lib/memory/learning");
      const { generalized } = generalizeContent(args.content);
      const { addMemoryEntryExt } = await import("@/lib/memory/memory-store");
      const entry = await addMemoryEntryExt(args.category, generalized, {
        relevance: args.relevance ?? 0.6,
        confidence: args.confidence ?? args.relevance ?? 0.6,
        scope: args.scope || "global_user",
        scopeKey: args.scopeKey,
        memoryType: args.memoryType,
        provenance: `tool:${api.taskId}`,
      });
      return { output: [{ type: "text", text: JSON.stringify({ saved: true, id: entry.id, generalized: generalized !== args.content }) }] as const };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: [{ type: "text", text: JSON.stringify({ error: msg, saved: false }) }] as const };
    }
  },
});

export async function buildDurableRegistry() {
  const registry = createRegistry();
  const { buildFilesExtension } = await import("@/lib/pi/durable-files");
  registry.install(buildFilesExtension());
  registry.install(defineExtension({ name: "memory", tools: [readMemoryTool, saveMemoryTool] }));
  const { buildGoalsExtension } = await import("@/lib/pi/durable-goals");
  registry.install(buildGoalsExtension());
  const { buildWebExtension } = await import("@/lib/pi/durable-web");
  registry.install(buildWebExtension());
  const { buildShellExtension } = await import("@/lib/pi/durable-shell");
  registry.install(buildShellExtension());
  const { buildSubagentsExtension } = await import("@/lib/pi/durable-subagents");
  registry.install(buildSubagentsExtension());
  const { buildGuardExtension } = await import("@/lib/pi/durable-guard");
  registry.install(buildGuardExtension());
  return registry;
}

export function approvalMemoKey(tool: string, argsHash: string): string {
  return `approval:${tool}:${argsHash}`;
}
