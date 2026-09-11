/**
 * Pi memory tools — persistent cross-chat memory, skills, and proactivity.
 * General-purpose: relevance-ranked retrieval, scoped search, safe writes,
 * self-created skills, and proactive preference management.
 */

import { tool } from "ai";
import { z } from "zod";

export function createPiMemoryTools(threadId: string): Record<string, any> {
  const read_memory = tool({
    description:
      "Recall persistent memory across ALL chats and sessions (factual + persona). " +
      "Call with a short query describing what you need (e.g. the user's name, preferences, past decisions, project details). " +
      "Returns the most relevant memories (bounded top-K, relevance-ranked). Call PROACTIVELY — do not wait for the user to say 'remember' or 'last time'. " +
      "Check memory before asking clarifying questions whenever the task touches identity, preferences, projects, stack, decisions, or ambiguous references ('it', 'my ...', 'that thing'). " +
      "Use scopeKey to prefer project-scoped memories; use memoryType to narrow (preference, decision, lesson_failure, pending_followup, ...).",
    inputSchema: z.object({
      query: z.string().describe("What to recall, e.g. 'user name and preferences'"),
      scopeKey: z.string().optional().describe("Project/workspace key to prefer scoped memories"),
      memoryType: z.string().optional().describe("Narrow by memory type"),
      scope: z.string().optional().describe("Narrow by scope (global_user, project, workspace, ...)"),
    }),
    execute: async ({ query, scopeKey, memoryType, scope }: { query: string; scopeKey?: string; memoryType?: string; scope?: string }) => {
      try {
        const mem = await import("@/lib/memory/memory-store");
        const { logMemoryRetrieved } = await import("@/lib/agent/observability");
        if ((scope || scopeKey || memoryType) && (mem as any).searchMemories) {
          const entries = await (mem as any).searchMemories({ query, scope, scopeKey, memoryType, topK: 8 });
          await logMemoryRetrieved(threadId, query, entries.map((e: any) => e.id), ["explicit search with filters"]).catch(() => {});
          if (entries.length === 0) return JSON.stringify({ entries: [], message: "No relevant memories stored yet." });
          return JSON.stringify({
            entries: entries.map((e: any) => ({
              id: e.id, category: e.category, content: e.content,
              confidence: e.confidence, scope: e.scope || "global_user",
              memoryType: e.memoryType || "context",
            })),
          });
        }
        const { getRelevantContext } = await import("@/lib/memory/memory-store");
        const ctx = await (getRelevantContext as any)(query, { scopeKey });
        await logMemoryRetrieved(threadId, query, [], ["auto context"]).catch(() => {});
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
      "goals ('I want to...'), constraints ('must/never/avoid...'). One concise fact per call; GENERALIZE to a reusable principle rather than storing raw incidents. " +
      "Do NOT store secrets, passwords, or tokens (blocked). Do NOT store ephemeral one-offs. " +
      "Use the smallest useful scope; pass scopeKey for project-specific facts.",
    inputSchema: z.object({
      category: z
        .enum(["personal", "preference", "project", "technology", "decision", "pattern", "constraint", "goal", "general"])
        .describe("Memory category"),
      content: z.string().describe("One concise, preferably generalized fact to remember"),
      relevance: z.number().min(0).max(1).optional().describe("Importance 0-1, default 0.6"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence 0-1 (explicit=high, single inference=low)"),
      scope: z.string().optional().describe("Scope (default global_user; use project/workspace for scoped facts)"),
      scopeKey: z.string().optional().describe("Project/workspace key when scoped"),
      memoryType: z.string().optional().describe("Semantic type (preference, decision, lesson_failure, ...)"),
    }),
    execute: async (args: { category: string; content: string; relevance?: number; confidence?: number; scope?: string; scopeKey?: string; memoryType?: string }) => {
      try {
        const { checkPersistable } = await import("@/lib/memory/safety");
        const gate = checkPersistable(args.content);
        if (!gate.ok) return JSON.stringify({ error: gate.reason, saved: false });
        const mem = await import("@/lib/memory/memory-store");
        if ((mem as any).addMemoryEntryExt) {
          const { generalizeContent } = await import("@/lib/memory/learning");
          const { generalized } = generalizeContent(args.content);
          const entry = await (mem as any).addMemoryEntryExt(args.category, generalized, {
            relevance: args.relevance ?? 0.6,
            confidence: args.confidence ?? args.relevance ?? 0.6,
            scope: args.scope || "global_user",
            scopeKey: args.scopeKey,
            memoryType: args.memoryType,
            provenance: `tool:${threadId}`,
            sourceConversation: threadId,
          });
          return JSON.stringify({ saved: true, id: entry.id, generalized: generalized !== args.content });
        }
        const { upsertMemoryWithContradictionCheck } = await import("@/lib/memory/memory-store");
        const { entry } = await upsertMemoryWithContradictionCheck(args.category, args.content, args.relevance ?? 0.6, args.confidence);
        return JSON.stringify({ saved: true, id: entry.id });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e), saved: false });
      }
    },
  });

  const manage_skill = tool({
    description:
      "Create, update, or deprecate a reusable self-learned skill (procedure, not a fact). " +
      "Use when you discover a reusable multi-step procedure: recurring error recovery, effective tool sequence, validation routine, data transform, or proactive workflow. " +
      "Skills must GENERALIZE (reusable strategy, not one URL/error/dataset). Lifecycle: candidate -> tested -> trusted -> deprecated. " +
      "Actions: create (name, description, instructions, whenToUse required), update, deprecate, get, list.",
    inputSchema: z.object({
      action: z.enum(["create", "update", "deprecate", "get", "list"]).describe("Skill action"),
      name: z.string().optional().describe("Skill name (lowercase-hyphens)"),
      description: z.string().optional().describe("What it does + when to use it"),
      instructions: z.string().optional().describe("Generalized procedure (≥30 words, no hardcoded single instance)"),
      whenToUse: z.string().optional().describe("When this skill applies"),
    }),
    execute: async (args: any) => {
      try {
        const { skillStore } = await import("@/lib/skills/store");
        const { validateSkillDraft, draftToSkillConfig } = await import("@/lib/skills/learner");
        const { logSkillEvent } = await import("@/lib/agent/observability");
        if (args.action === "list") {
          const all = skillStore.getAll();
          return JSON.stringify({ skills: all.map((s) => ({ name: s.name, description: s.description, source: s.source })) });
        }
        if (args.action === "get") {
          if (!args.name) return JSON.stringify({ error: "name required" });
          const s = skillStore.getByName(args.name);
          if (!s) return JSON.stringify({ error: "Skill not found" });
          return JSON.stringify({ skill: { name: s.name, description: s.description, instructions: (s.instructions || "").slice(0, 3000) } });
        }
        if (args.action === "deprecate") {
          if (!args.name) return JSON.stringify({ error: "name required" });
          const s = skillStore.getByName(args.name);
          if (!s) return JSON.stringify({ error: "Skill not found" });
          if ((s as any).isSystem) return JSON.stringify({ error: "System skills cannot be deprecated" });
          const res = skillStore.upsert({ name: args.name, description: s.description, instructions: `${s.instructions}\n\n<!-- status: deprecated -->` } as any);
          await logSkillEvent(threadId, "deprecated", args.name, "agent deprecated after failure").catch(() => {});
          return JSON.stringify({ deprecated: res.ok, skill: res.skill?.name });
        }
        // create / update
        if (!args.name || !args.description || !args.instructions || !args.whenToUse) {
          return JSON.stringify({ error: "create/update require name, description, instructions, whenToUse" });
        }
        const err = validateSkillDraft({ name: args.name, description: args.description, instructions: args.instructions, whenToUse: args.whenToUse, scope: "global_user", confidence: 0.5, provenance: `thread:${threadId}`, preconditions: [], failureModes: [], recoverySteps: [], validation: "reuse twice successfully" });
        if (err) return JSON.stringify({ error: err, saved: false });
        const cfg = draftToSkillConfig({ name: args.name, description: args.description, instructions: args.instructions, whenToUse: args.whenToUse, preconditions: [], failureModes: [], recoverySteps: [], validation: "reuse twice successfully", scope: "global_user", confidence: 0.5, provenance: `thread:${threadId}` });
        const res = skillStore.upsert({ ...cfg, source: "custom" } as any);
        if (!res.ok) return JSON.stringify({ error: res.error, saved: false });
        await logSkillEvent(threadId, args.action === "create" ? "created" : "updated", args.name, "agent self-created reusable procedure").catch(() => {});
        return JSON.stringify({ saved: true, skill: res.skill?.name, status: "candidate — validate by reuse" });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });

  const manage_proactive = tool({
    description:
      "Manage proactive preferences and follow-ups (least-intrusive assistance). " +
      "Actions: suggest (record a one-time suggestion), prefer (store recurring preference with topic/kind/frequency/scope), feedback (accept/reject/pause/cancel a preference or suggestion), list, cancel. " +
      "Never auto-create recurring monitoring from a single mention — suggest first. Never perform external side effects without confirmation — prepare a draft instead. " +
      "Recurring work uses schedule_task; this tool owns the decision state (evidence, confidence, dedupe, fatigue).",
    inputSchema: z.object({
      action: z.enum(["suggest", "prefer", "feedback", "list", "cancel"]).describe("Proactive action"),
      topic: z.string().optional().describe("Topic or need description"),
      kind: z.string().optional().describe("recurring_report | reminder | monitor | threshold | followup | suggestion"),
      frequency: z.string().optional().describe("e.g. daily, weekly, every Friday morning"),
      scopeKey: z.string().optional().describe("Project key for project-scoped monitoring"),
      id: z.string().optional().describe("Preference/suggestion id for feedback/cancel"),
      outcome: z.string().optional().describe("accepted | rejected | paused | cancelled | dismissed | ignored"),
      evidence: z.string().optional().describe("Why this may be useful (1-2 sentences)"),
    }),
    execute: async (args: any) => {
      try {
        const store = await import("@/lib/proactivity/store");
        const engine = await import("@/lib/proactivity/engine");
        const { logProactiveEvent } = await import("@/lib/agent/observability");
        if (args.action === "list") {
          const state = await store.loadProactiveState();
          return JSON.stringify({
            preferences: state.preferences.map((p) => ({ id: p.id, topic: p.topic, kind: p.kind, enabled: p.enabled, scope: p.scope })),
            recentSuggestions: state.suggestions.slice(-10).map((s) => ({ id: s.id, topic: s.topic, decision: s.decision, outcome: s.outcome || "pending" })),
          });
        }
        if (args.action === "suggest") {
          if (!args.topic) return JSON.stringify({ error: "topic required" });
          const state = await store.loadProactiveState();
          const prior = engine.findPriorSuggestion(state.suggestions, args.topic, args.scopeKey);
          if (prior && (prior.outcome === "rejected" || prior.outcome === "dismissed") && !args.evidence?.includes("explicit")) {
            await logProactiveEvent(threadId, "suppressed", args.topic, "previously rejected — not re-suggesting").catch(() => {});
            return JSON.stringify({ suggested: false, reason: "Previously rejected — not re-suggesting without new explicit evidence." });
          }
          const rec = await store.recordSuggestion({
            topic: args.topic, scope: args.scopeKey ? "project" : "global_user", scopeKey: args.scopeKey,
            kind: "suggestion", decision: "suggest_once", evidence: args.evidence ? [args.evidence] : ["agent-identified opportunity"],
            confidence: 0.6,
          });
          await logProactiveEvent(threadId, "suggested", args.topic, args.evidence || "suggestion recorded").catch(() => {});
          return JSON.stringify({ suggested: true, id: rec.id, note: "Present as a brief one-time suggestion; do NOT auto-schedule." });
        }
        if (args.action === "prefer") {
          if (!args.topic) return JSON.stringify({ error: "topic required" });
          const pref = await store.upsertPreference({
            topic: args.topic,
            scope: args.scopeKey ? "project" : "global_user",
            scopeKey: args.scopeKey,
            kind: (args.kind as any) || "recurring_report",
            frequency: args.frequency,
            enabled: true,
            confidence: 0.8,
          });
          await logProactiveEvent(threadId, "scheduled", args.topic, `preference stored (${pref.kind})`).catch(() => {});
          return JSON.stringify({ saved: true, id: pref.id, note: "Use schedule_task for exact timing; this records the preference." });
        }
        if (args.action === "feedback") {
          if (!args.id || !args.outcome) return JSON.stringify({ error: "id and outcome required" });
          const state = await store.loadProactiveState();
          const sug = state.suggestions.find((s) => s.id === args.id);
          if (sug) {
            await store.recordSuggestionOutcome(args.id, args.outcome);
            await logProactiveEvent(threadId, "rejected_learned", sug.topic, `outcome: ${args.outcome}`).catch(() => {});
            return JSON.stringify({ recorded: true });
          }
          const pref = state.preferences.find((p) => p.id === args.id);
          if (pref) {
            const next = engine.applyFeedback(pref, args.outcome);
            await store.upsertPreference({ ...next, id: pref.id });
            return JSON.stringify({ recorded: true, enabled: next.enabled });
          }
          return JSON.stringify({ error: "id not found" });
        }
        if (args.action === "cancel") {
          if (!args.id) return JSON.stringify({ error: "id required" });
          const ok = await store.cancelPreference(args.id);
          return JSON.stringify({ cancelled: ok });
        }
        return JSON.stringify({ error: "unknown action" });
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

  return { read_memory, save_memory, manage_skill, manage_proactive, list_sessions, read_session_summary, read_session };
}
