/**
 * Deterministic observer — the SINGLE auto-extraction path for user turns.
 *
 * Replaces the old duplicated `extractAndSaveMemories` (regex whole-message
 * dump) + `inferPreference`-in-protocol double path. Splits user text into
 * atomic sentences, keeps only signal-bearing ones, normalizes first-person
 * to third-person ("I prefer X" → "User prefers X"), and funnels everything
 * through the single `remember` write path (so dedupe/supersede applies).
 *
 * Idempotent per thread+text via a small watermark LRU: the harness and the
 * post-task protocol may both call observeTurn for the same turn; the second
 * call is a no-op instead of a double-reinforce.
 */

import { rememberMemory } from "./tools-core";

const seen = new Map<string, number>();
const SEEN_MAX = 200;

function watermark(threadId: string, text: string): string {
  let h = 0;
  const s = `${threadId}\n${text}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${threadId}:${h}`;
}

function markSeen(key: string): boolean {
  const now = Date.now();
  // opportunistically evict stale (>1h)
  if (seen.size > SEEN_MAX) {
    for (const [k, ts] of seen) if (now - ts > 3_600_000) seen.delete(k);
    if (seen.size > SEEN_MAX) {
      const first = seen.keys().next().value;
      if (first) seen.delete(first);
    }
  }
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

type Candidate = {
  fact: string;
  category: string;
  memoryType?: string;
  confidence: number;
  importance: number;
  confirmation: "explicit" | "inferred";
};

const VERB_MAP: Array<[RegExp, string]> = [
  [/^i prefer\b/i, "User prefers"],
  [/^i like\b/i, "User likes"],
  [/^i love\b/i, "User loves"],
  [/^i hate\b/i, "User hates"],
  [/^i dislike\b/i, "User dislikes"],
  [/^i want\b/i, "User wants"],
  [/^i need\b/i, "User needs"],
  [/^i plan\b/i, "User plans"],
  [/^i use\b/i, "User uses"],
  [/^i work\b/i, "User works"],
  [/^i live\b/i, "User lives"],
  [/^i['’]m\b/i, "User is"],
  [/^i am\b/i, "User is"],
  [/^i have\b/i, "User has"],
  [/^my name is\b/i, "User's name is"],
  [/^my favorite\b/i, "User's favorite"],
  [/^my favourite\b/i, "User's favourite"],
];

function normalizeFact(sentence: string): string {
  let s = sentence.trim().replace(/\s+/g, " ");
  // Strip "remember that / don't forget that" wrappers, keep the fact.
  s = s.replace(/^(please\s+)?(remember|don't forget|dont forget)\s*:?\s*(that\s+)?/i, "");
  for (const [re, rep] of VERB_MAP) {
    if (re.test(s)) { s = s.replace(re, rep); break; }
  }
  // "my X" → "user's X" for the common identity slots.
  s = s.replace(/\bmy (project|wife|husband|dog|cat|birthday|email|phone|team|company)\b/gi, "user's $1");
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

function categorizeFact(text: string): { category: string; memoryType?: string } {
  const t = text.toLowerCase();
  if (/user'?s name is|call me|user is a |user works as|user'?s (wife|husband|family|dog|cat|birthday)/.test(t)) return { category: "personal", memoryType: "explicit" };
  if (/prefer|like|love|hate|dislike|favor|concise|detailed|brief|format|csv|morning|evening/.test(t)) return { category: "preference", memoryType: "preference" };
  if (/decided|decision|chose|going with|switched to|moved to/.test(t)) return { category: "decision", memoryType: "decision" };
  if (/must|never|always|constraint|avoid|can'?t|cannot/.test(t)) return { category: "constraint", memoryType: "constraint" };
  if (/want to|plan to|trying to|goal|deadline|remind|follow.?up/.test(t)) return { category: "goal", memoryType: /deadline|remind|follow.?up|later|tomorrow/.test(t) ? "pending_followup" : "goal" };
  if (/project|building|working on|repo|app|stack|using|postgres|react|next\.js|tauri/.test(t)) return { category: "project", memoryType: "project_knowledge" };
  return { category: "general" };
}

const EXPLICIT_RE = /\b(remember|don't forget|dont forget|my name is|call me)\b/i;
const SIGNAL_RES = [
  /\b(prefer|like|love|hate|dislike|favorite|favourite|concise|detailed|brief)\b/i,
  /\b(my name is|call me|i work (at|on|as)|i'?m a|i am a|my (project|wife|husband|dog|cat|birthday|email|phone|team|company))\b/i,
  /\b(we |i )?(decided|decision|chose|going with|switched to|moved to)\b/i,
  /\b(must|never|always|avoid|can'?t|cannot)\b/i,
  /\b(i want to|i plan to|trying to|deadline|remind me|follow.?up)\b/i,
  /\b(i'?m (working on|building)|my (project|stack|repo|app))\b/i,
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 300);
}

function isQuestion(s: string): boolean {
  if (s.trim().endsWith("?")) return true;
  return /^(do you|can you|could you|would you|what|when|where|who|why|how|is |are |does |do )/i.test(s.trim());
}

/** Extract atomic memory candidates from raw user text (pure, testable). */
export function extractCandidates(userText: string): Candidate[] {
  const out: Candidate[] = [];
  const explicitWhole = EXPLICIT_RE.test(userText);
  for (const sentence of splitSentences(userText)) {
    if (isQuestion(sentence)) continue;
    const explicit = EXPLICIT_RE.test(sentence);
    const signaled = explicit || SIGNAL_RES.some((re) => re.test(sentence));
    if (!signaled) continue;
    // Bare "remember ..." with no fact content → ephemeral, skip.
    if (/^(please\s+)?(remember|don't forget)\s*[.!?]*$/i.test(sentence.trim())) continue;
    const fact = normalizeFact(sentence);
    if (fact.length < 12) continue;
    const { category, memoryType } = categorizeFact(fact);
    out.push({
      fact,
      category,
      memoryType,
      confidence: explicit ? 0.9 : 0.55,
      importance: explicit ? 0.8 : category === "personal" ? 0.75 : 0.55,
      confirmation: explicit || explicitWhole ? "explicit" : "inferred",
    });
    if (out.length >= 3) break; // atomic: at most 3 per turn
  }
  return out;
}

export type ObserveOutcome = {
  evaluated: boolean;
  written: Array<{ id: string; category: string; action: string }>;
  skippedReason?: string;
};

/**
 * Observe one user turn. Idempotent per thread+text. Never throws.
 * Fire-and-forget from the harness; awaited in tests/protocol.
 */
export async function observeTurn(opts: {
  threadId: string;
  userText: string;
  scopeKey?: string;
}): Promise<ObserveOutcome> {
  const empty: ObserveOutcome = { evaluated: true, written: [], skippedReason: "no signal" };
  try {
    const text = (opts.userText || "").trim().slice(0, 2000);
    if (text.length < 8) return { ...empty, skippedReason: "too short" };
    if (markSeen(watermark(opts.threadId, text))) return { ...empty, skippedReason: "already observed" };
    const cands = extractCandidates(text);
    if (cands.length === 0) return empty;
    const written: ObserveOutcome["written"] = [];
    for (const c of cands) {
      try {
        const res = await rememberMemory(
          {
            category: c.category,
            content: c.fact,
            relevance: 0.65,
            confidence: c.confidence,
            scope: "global_user",
            scopeKey: opts.scopeKey,
            memoryType: c.memoryType,
          },
          { threadId: opts.threadId, provenance: `observe:${opts.threadId}` },
        );
        if (res.saved && res.id) {
          written.push({ id: res.id, category: c.category, action: res.action || "created" });
          try {
            const { logMemoryWritten } = await import("@/lib/agent/observability");
            await logMemoryWritten(opts.threadId, res.id, c.category, `observed (${res.action})`).catch(() => {});
          } catch {}
        }
      } catch {}
    }
    return { evaluated: true, written };
  } catch {
    return { evaluated: true, written: [], skippedReason: "observer error" };
  }
}

/** Test helper: clear the watermark LRU. */
export function __resetObserveForTests(): void {
  seen.clear();
}
