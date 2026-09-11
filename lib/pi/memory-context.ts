/**
 * VoiceMem recall context + background memory extraction for the Pi harness.
 * Runs under the hood: no settings, no UI. Never throws (memory is non-fatal).
 */

function lastUserText(messages: Array<Record<string, unknown>>): string {
  try {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m: any = messages[i];
      if (m.role !== "user") continue;
      const parts = m.parts || m.content;
      if (Array.isArray(parts)) {
        const text = parts
          .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
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

/** Warm VoiceMem cache + recall relevant memories and past chats for this turn. */
export async function buildMemoryContext(
  messages: Array<Record<string, unknown>>,
  currentThreadId: string,
  opts?: { scopeKey?: string; proactiveTopic?: string },
): Promise<string> {
  try {
    const mem = await import("@/lib/memory/memory-store");
    await mem.warmup?.().catch(() => {});
    const query = lastUserText(messages);
    const [recall, sessions, proactive] = await Promise.all([
      query ? (mem as any).getRelevantContext
        ? (mem as any).getRelevantContext(query, { scopeKey: opts?.scopeKey }).catch(() => "")
        : Promise.resolve("") : Promise.resolve(""),
      import("@/lib/memory/session-store")
        .then((m) => m.listSessions().catch(() => []))
        .catch(() => [] as any[]),
      // Proactive state: active prefs + recent suggestion outcomes gate suggestions.
      import("@/lib/proactivity/store")
        .then((m) => m.loadProactiveState().catch(() => null))
        .catch(() => null),
    ]);
    try {
      const { logMemoryRetrieved } = await import("@/lib/agent/observability");
      if (query && recall) {
        await logMemoryRetrieved(currentThreadId, query.slice(0, 200), [], ["auto-inject top-5"]).catch(() => {});
      }
    } catch {}
    const blocks: string[] = [];
    if (recall && recall.trim()) {
      // Bounded injection (§24): top-5 only, never the whole DB.
      blocks.push(`## Recalled memory (auto — relevant to this message, relevance-ranked, bounded)\n${recall.trim().slice(0, 1600)}`);
    }
    const others = (sessions as any[])
      .filter((s) => s.id !== currentThreadId)
      .slice(0, 6);
    if (others.length > 0) {
      blocks.push(
        `## Past chats (use list_sessions/read_session to recall details when the user refers to them)\n` +
          others.map((s) => `- ${s.title || "Untitled"} [${s.id}]`).join("\n"),
      );
    }
    if (proactive) {
      const active = (proactive.preferences || []).filter((p: any) => p.enabled);
      if (active.length > 0) {
        blocks.push(
          `## Active proactive preferences (${active.length})\n` +
            active.slice(0, 5).map((p: any) => `- ${p.kind}: ${p.topic.slice(0, 100)}${p.frequency ? ` (${p.frequency})` : ""} [scope:${p.scope}]`).join("\n"),
        );
      }
      const recentRejected = (proactive.suggestions || []).filter((s: any) => s.outcome === "rejected" || s.outcome === "dismissed").slice(-3);
      if (recentRejected.length > 0) {
        blocks.push(
          `## Recently rejected suggestions (do NOT re-suggest these)\n` +
            recentRejected.map((s: any) => `- ${s.topic.slice(0, 100)}`).join("\n"),
        );
      }
    }
    return blocks.join("\n\n");
  } catch {
    return "";
  }
}

const REMEMBER_RE = /\b(remember|don't forget|dont forget|my name is|call me|i prefer|i like|i love|i hate|i dislike|my favorite|my favourite|i work (at|on|as)|i'm a|i am a|my (project|wife|husband|dog|cat|birthday|email|phone))\b/i;

function categorizeFact(text: string): string {
  const t = text.toLowerCase();
  if (/my name is|call me|i'm a|i am a|my (wife|husband|family|dog|cat|birthday)/.test(t)) return "personal";
  if (/prefer|like|love|hate|dislike|favorite|favourite/.test(t)) return "preference";
  if (/project|building|working on|repo|app/.test(t)) return "project";
  if (/decided|decision|we chose|going with/.test(t)) return "decision";
  if (/must|never|always|constraint|don't|do not/.test(t)) return "constraint";
  if (/goal|want to|plan to|trying to/.test(t)) return "goal";
  return "general";
}

/**
 * Fire-and-forget extraction: pull durable facts from the latest user
 * message(s) and store them. Heuristic-only so it always works, even with
 * no model configured.
 */
export function extractAndSaveMemories(
  messages: Array<Record<string, unknown>>,
): void {
  try {
    const texts: string[] = [];
    for (let i = messages.length - 1; i >= 0 && texts.length < 3; i--) {
      const m: any = messages[i];
      if (m?.role !== "user") continue;
      const parts = m.parts || m.content;
      let text = "";
      if (Array.isArray(parts)) {
        text = parts
          .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
          .filter(Boolean)
          .join(" ")
          .trim();
      } else if (typeof parts === "string") {
        text = parts.trim();
      }
      if (text) texts.unshift(text);
    }
    const candidates = texts.filter((t) => t.length >= 12 && t.length <= 600 && REMEMBER_RE.test(t));
    if (candidates.length === 0) return;
    void (async () => {
      try {
        const { upsertMemoryWithContradictionCheck, getMemoryEntries } = await import(
          "@/lib/memory/memory-store"
        );
        const existing = await getMemoryEntries().catch(() => []);
        for (const content of candidates) {
          const dup = existing.some(
            (e) => e.content.toLowerCase() === content.toLowerCase().slice(0, 600),
          );
          if (dup) continue;
          await upsertMemoryWithContradictionCheck(
            categorizeFact(content),
            content.slice(0, 600),
            0.65,
          ).catch(() => {});
        }
      } catch {}
    })();
  } catch {}
}
