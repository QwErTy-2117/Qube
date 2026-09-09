/**
 * Pi memory tools — VoiceMem-backed recall across all chats, under the hood.
 * No UI references VoiceMem; the agent simply remembers and recalls.
 */

import { tool } from "ai";
import { z } from "zod";

export function createPiMemoryTools(_threadId: string): Record<string, any> {
  const read_memory = tool({
    description:
      "Recall persistent memory across ALL chats and sessions (VoiceMem dual-brain: factual + persona). " +
      "Call with a short query describing what you need (e.g. the user's name, preferences, past decisions, project details). " +
      "Returns the most relevant memories. Call PROACTIVELY — do not wait for the user to say 'remember' or 'last time'. " +
      "Check memory before asking clarifying questions whenever the task touches identity, preferences, projects, stack, decisions, or ambiguous references ('it', 'my ...', 'that thing').",
    inputSchema: z.object({
      query: z.string().describe("What to recall, e.g. 'user name and preferences'"),
    }),
    execute: async ({ query }: { query: string }) => {
      try {
        const { getRelevantContext } = await import("@/lib/memory/memory-store");
        const ctx = await getRelevantContext(query);
        if (!ctx) return JSON.stringify({ entries: [], message: "No relevant memories stored yet." });
        return JSON.stringify({ context: ctx });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });

  const save_memory = tool({
    description:
      "Save a durable memory across ALL chats and sessions (remembered automatically next time). " +
      "Use for: user name, preferences, project facts, decisions, constraints, goals, personal details. " +
      "Save PROACTIVELY even when the user never says 'remember this' — infer from indirect cues: 'I always/never...', " +
      "'I prefer/like/hate...', 'we decided/chose/switched to...', 'I'm working on...', corrections ('actually...'), " +
      "goals ('I want to...'), constraints ('must/never/avoid...'). One concise fact per call. " +
      "Do NOT store secrets, passwords, or tokens. Do NOT store ephemeral one-offs.",
    inputSchema: z.object({
      category: z
        .enum(["personal", "preference", "project", "technology", "decision", "pattern", "constraint", "goal", "general"])
        .describe("Memory category"),
      content: z.string().describe("One concise fact to remember"),
      relevance: z.number().min(0).max(1).optional().describe("Importance 0-1, default 0.6"),
    }),
    execute: async (args: { category: string; content: string; relevance?: number }) => {
      try {
        const { upsertMemoryWithContradictionCheck } = await import("@/lib/memory/memory-store");
        const { entry } = await upsertMemoryWithContradictionCheck(
          args.category,
          args.content,
          args.relevance ?? 0.6,
        );
        return JSON.stringify({ saved: true, id: entry.id });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });

  const list_sessions = tool({
    description:
      "List past chat sessions (any chat the user has had). Use to find and recall earlier conversations. " +
      "Returns id, title, and timestamps, newest first.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { listSessions } = await import("@/lib/memory/session-store");
        const sessions = await listSessions();
        return JSON.stringify({
          sessions: sessions.slice(0, 30).map((s) => ({
            id: s.id,
            title: s.title,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });

  const read_session_summary = tool({
    description: "Read a past chat's title and summary without the full transcript.",
    inputSchema: z.object({
      id: z.string().describe("Session id from list_sessions"),
    }),
    execute: async ({ id }: { id: string }) => {
      try {
        const { readSessionSummary } = await import("@/lib/memory/session-store");
        const s = await readSessionSummary(id);
        if (!s) return JSON.stringify({ error: "Session not found" });
        return JSON.stringify({ session: s });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });

  const read_session = tool({
    description:
      "Read the full transcript of a past chat session. Use when the user asks about an earlier conversation.",
    inputSchema: z.object({
      id: z.string().describe("Session id from list_sessions"),
    }),
    execute: async ({ id }: { id: string }) => {
      try {
        const { readSession } = await import("@/lib/memory/session-store");
        const s = await readSession(id);
        if (!s) return JSON.stringify({ error: "Session not found" });
        const transcript = (s.transcript || "").slice(0, 12000);
        return JSON.stringify({ id: s.id, title: s.title, summary: s.summary, transcript });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });

  return { read_memory, save_memory, list_sessions, read_session_summary, read_session };
}
