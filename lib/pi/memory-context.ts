/**
 * Memory recall context + background observation for the Pi harness.
 * Single memory block via lib/memory/brief; single observer via
 * lib/memory/observe. Never throws (memory is non-fatal).
 */

import { isMemoryEnabled } from "@/lib/memory/tools-core";

function lastUserText(messages: Array<Record<string, unknown>>): string {
  try {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m: unknown = messages[i];
      if ((m as { role?: string }).role !== "user") continue;
      const parts = (m as { parts?: unknown; content?: unknown }).parts ?? (m as { content?: unknown }).content;
      if (Array.isArray(parts)) {
        const text = (parts as Array<{ text?: unknown }>)
          .map((p) => (typeof p?.text === "string" ? p.text : ""))
          .filter(Boolean)
          .join(" ")
          .trim();
        if (text) return text.slice(0, 500);
      } else if (typeof parts === "string" && parts.trim()) {
        return parts.trim().slice(0, 500);
      }
    }
  } catch {}
  return "";
}

/** Warm cache + recall the single bounded memory block + past-chat index. */
export async function buildMemoryContext(
  messages: Array<Record<string, unknown>>,
  currentThreadId: string,
  opts?: { scopeKey?: string; proactiveTopic?: string },
): Promise<string> {
  try {
    const memoryOn = isMemoryEnabled();
    const query = lastUserText(messages);
    const [briefMod, sessions, proactive] = await Promise.all([
      memoryOn ? import("@/lib/memory/brief").catch(() => null) : Promise.resolve(null),
      import("@/lib/memory/session-store")
        .then((m) => m.listSessions().catch(() => []))
        .catch(() => [] as Array<{ id: string; title?: string }>),
      import("@/lib/proactivity/store")
        .then((m) => m.loadProactiveState().catch(() => null))
        .catch(() => null),
    ]);
    let brief = "";
    if (briefMod && memoryOn) {
      try {
        brief = await briefMod.buildMemoryBrief({ query, scopeKey: opts?.scopeKey });
      } catch {}
      try {
        const { logMemoryRetrieved } = await import("@/lib/agent/observability");
        if (query && brief) {
          await logMemoryRetrieved(currentThreadId, query.slice(0, 200), [], ["auto-inject brief"]).catch(() => {});
        }
      } catch {}
    }
    const blocks: string[] = [];
    if (brief && brief.trim()) {
      blocks.push(`## Recalled memory (auto — bounded, relevance-ranked)\n${brief.trim().slice(0, 3600)}`);
    }
    const others = ((sessions as Array<{ id: string; title?: string }>) || [])
      .filter((s) => s.id !== currentThreadId)
      .slice(0, 6);
    if (others.length > 0) {
      blocks.push(
        `## Past chats (use list_sessions/read_session to recall details when the user refers to them)\n` +
          others.map((s) => `- ${s.title || "Untitled"} [${s.id}]`).join("\n"),
      );
    }
    if (proactive) {
      const active = (proactive.preferences || []).filter((p: { enabled?: boolean }) => p.enabled);
      if (active.length > 0) {
        blocks.push(
          `## Active proactive preferences (${active.length})\n` +
            active.slice(0, 5).map((p: { kind?: string; topic?: string; frequency?: string; scope?: string }) => `- ${p.kind}: ${(p.topic || "").slice(0, 100)}${p.frequency ? ` (${p.frequency})` : ""} [scope:${p.scope}]`).join("\n"),
        );
      }
      const recentRejected = (proactive.suggestions || []).filter((s: { outcome?: string }) => s.outcome === "rejected" || s.outcome === "dismissed").slice(-3);
      if (recentRejected.length > 0) {
        blocks.push(
          `## Recently rejected suggestions (do NOT re-suggest these)\n` +
            recentRejected.map((s: { topic?: string }) => `- ${(s.topic || "").slice(0, 100)}`).join("\n"),
        );
      }
    }
    try {
      const { buildHeartbeatBrief } = await import("@/lib/proactivity/heartbeat-brief");
      const hb = await buildHeartbeatBrief({ query, threadId: currentThreadId }).catch(() => null);
      if (hb && !hb.empty) {
        if (hb.announcementsBlock) blocks.push(`## Background news — weave into this reply\n${hb.announcementsBlock}`);
        if (hb.announcementHistoryBlock) blocks.push(`## Already-announced facts — answer explicit questions normally\n${hb.announcementHistoryBlock}`);
        if (hb.approvalBlock) blocks.push(`## Background approvals — ask once\n${hb.approvalBlock}`);
        if (hb.workBlock) blocks.push(`## Heartbeat work — continue from progress\n${hb.workBlock}`);
        if (hb.heartbeatBlock) blocks.push(`## Heartbeat — what to remember\n${hb.heartbeatBlock}`);
        if (hb.scheduledBlock) blocks.push(`## Scheduled tasks — what to remember\n${hb.scheduledBlock}`);
        if (hb.suggestionsBlock) blocks.push(`## Custom suggestions for this user\n${hb.suggestionsBlock}`);
      }
    } catch {}
    try {
      const { buildGoalsBrief } = await import("@/lib/goals/store");
      const goalsBlock = await buildGoalsBrief(5).catch(() => undefined);
      if (goalsBlock) blocks.push(`## Goals — resume or close\n${goalsBlock}`);
    } catch {}
    return blocks.join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Fire-and-forget observation: single deterministic observer for the latest
 * user message(s). Idempotent per thread+text (see lib/memory/observe).
 */
export function extractAndSaveMemories(messages: Array<Record<string, unknown>>, threadId?: string): void {
  try {
    const texts: string[] = [];
    for (let i = messages.length - 1; i >= 0 && texts.length < 3; i--) {
      const m = messages[i] as { role?: string; parts?: unknown; content?: unknown };
      if (m?.role !== "user") continue;
      const parts = m.parts ?? m.content;
      let text = "";
      if (Array.isArray(parts)) {
        text = (parts as Array<{ text?: unknown }>)
          .map((p) => (typeof p?.text === "string" ? (p.text as string) : ""))
          .filter(Boolean)
          .join(" ")
          .trim();
      } else if (typeof parts === "string") {
        text = parts.trim();
      }
      if (text) texts.unshift(text);
    }
    const latest = texts[texts.length - 1] || "";
    if (latest.length < 8) return;
    if (!isMemoryEnabled()) return;
    const tid = threadId || "legacy-harness";
    void (async () => {
      try {
        const { observeTurn } = await import("@/lib/memory/observe");
        await observeTurn({ threadId: tid, userText: latest }).catch(() => {});
      } catch {}
    })();
  } catch {}
}
