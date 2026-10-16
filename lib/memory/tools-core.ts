/**
 * Single shared memory tool core — the ONLY implementation of read_memory /
 * save_memory logic. The legacy Vercel-AI-SDK tools, the pi-durable tools,
 * and the headless task-runner all adapt these plain functions, so behavior
 * can never drift between agent paths again.
 */
import { settingsStore } from "@/lib/settings-store";

export const MEMORY_CATEGORIES = ["personal", "preference", "project", "technology", "decision", "pattern", "constraint", "goal", "general"] as const;

export const READ_MEMORY_DESCRIPTION =
  "Recall persistent memory across ALL chats and sessions (factual + persona). " +
  "Call with a short query describing what you need (e.g. the user's name, preferences, past decisions, project details). " +
  "Returns the most relevant memories (bounded top-K, relevance-ranked). Call PROACTIVELY — do not wait for the user to say 'remember' or 'last time'. " +
  "Check memory before asking clarifying questions whenever the task touches identity, preferences, projects, stack, decisions, or ambiguous references ('it', 'my ...', 'that thing'). " +
  "Use scopeKey to prefer project-scoped memories; use memoryType to narrow (preference, decision, lesson_failure, pending_followup, ...). " +
  "Empty query returns the highest-priority memories.";

export const SAVE_MEMORY_DESCRIPTION =
  "Save a durable memory across ALL chats and sessions (remembered automatically next time). " +
  "Use for: user name, preferences, project facts, decisions, constraints, goals, personal details. " +
  "Save PROACTIVELY even when the user never says 'remember this' — infer from indirect cues: 'I always/never...', " +
  "'I prefer/like/hate...', 'we decided/chose/switched to...', 'I'm working on...', corrections ('actually...'), " +
  "goals ('I want to...'), constraints ('must/never/avoid...'). One concise fact per call; GENERALIZE to a reusable principle rather than storing raw incidents. " +
  "Near-duplicates reinforce the existing memory instead of duplicating; contradictions supersede the old value. " +
  "Do NOT store secrets, passwords, or tokens (blocked). Do NOT store ephemeral one-offs. " +
  "Use the smallest useful scope; pass scopeKey for project-specific facts.";

export function isMemoryEnabled(): boolean {
  try {
    return settingsStore.getAll().memoryEnabled !== false;
  } catch {
    return true;
  }
}

export type RecallArgs = {
  query?: string;
  scopeKey?: string;
  memoryType?: string;
  scope?: string;
  category?: string;
  topK?: number;
};

export type RecallResult = {
  entries: Array<{
    id: string; category: string; content: string; confidence: number;
    scope: string; memoryType: string; updatedAt: number;
  }>;
  total: number;
  fallback?: boolean;
  message?: string;
};

/** Shared read path. Never throws — returns a message payload on empty/disabled. */
export async function recallMemory(args: RecallArgs, ctx?: { threadId?: string }): Promise<RecallResult> {
  if (!isMemoryEnabled()) {
    return { entries: [], total: 0, message: "Memory is disabled for this session." };
  }
  try {
    const mem = await import("./memory-store");
    const topK = Math.min(Math.max(args.topK ?? 8, 1), 20);
    const query = (args.query || "").trim();
    const entries = query
      ? await mem.searchMemories({ query, scope: args.scope, scopeKey: args.scopeKey, memoryType: args.memoryType, category: args.category, topK })
      : await mem.getTopEntries(topK, args.scopeKey);
    try {
      const { logMemoryRetrieved } = await import("@/lib/agent/observability");
      await logMemoryRetrieved(ctx?.threadId || "memory", query || "(browse)", entries.map((e) => e.id), [query ? "tool recall" : "tool browse"]).catch(() => {});
    } catch {}
    if (entries.length === 0) {
      // Fall back to the priority core so the agent still sees identity basics.
      const top = await mem.getTopEntries(Math.min(topK, 5), args.scopeKey).catch(() => []);
      if (top.length > 0) {
        return {
          entries: top.map(toEntry),
          total: top.length,
          fallback: true,
          message: "No direct match; showing highest-priority memories. Ask the user if none apply.",
        };
      }
      return { entries: [], total: 0, message: "No relevant memories stored yet." };
    }
    return { entries: entries.map(toEntry), total: entries.length };
  } catch (e: unknown) {
    return { entries: [], total: 0, message: `Memory recall failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function toEntry(e: { id: string; category: string; content: string; confidence: number; scope?: string; memoryType?: string; updatedAt: number }): RecallResult["entries"][number] {
  return {
    id: e.id, category: e.category, content: e.content, confidence: e.confidence,
    scope: e.scope || "global_user", memoryType: e.memoryType || "context", updatedAt: e.updatedAt,
  };
}

export type RememberArgs = {
  category: string;
  content: string;
  relevance?: number;
  confidence?: number;
  scope?: string;
  scopeKey?: string;
  memoryType?: string;
};

export type RememberToolResult = {
  saved: boolean;
  id?: string;
  action?: string;
  generalized?: boolean;
  superseded?: string[];
  error?: string;
};

/** Shared write path. Runs safety gate + generalize + dedupe via the single store. */
export async function rememberMemory(args: RememberArgs, ctx: { threadId?: string; provenance?: string }): Promise<RememberToolResult> {
  if (!isMemoryEnabled()) {
    return { saved: false, error: "Memory is disabled for this session." };
  }
  const content = (args.content || "").trim().slice(0, 600);
  if (!content) return { saved: false, error: "Empty content — nothing to remember." };
  try {
    const mem = await import("./memory-store");
    const before = content;
    const { entry, action, superseded } = await mem.remember(args.category, content, {
      relevance: args.relevance ?? 0.6,
      confidence: args.confidence ?? args.relevance ?? 0.6,
      scope: args.scope || "global_user",
      scopeKey: args.scopeKey,
      memoryType: args.memoryType,
      provenance: ctx.provenance || (ctx.threadId ? `tool:${ctx.threadId}` : "tool"),
      sourceConversation: ctx.threadId,
      confirmation: /^(remember|my name is|call me|my preferred|please always|please never)\b/i.test(content) ? "explicit" : undefined,
    });
    return {
      saved: true, id: entry.id, action,
      generalized: entry.content !== before,
      superseded: superseded.map((s) => s.id),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { saved: false, error: msg };
  }
}
