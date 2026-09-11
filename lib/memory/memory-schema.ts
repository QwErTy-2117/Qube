/**
 * Memory schema — typed, scoped, confidence-weighted memories.
 *
 * Extends the existing dual-brain MemoryEntry (voicemem-core) without breaking
 * backward compat. All new fields are optional with safe defaults via
 * `withMemoryDefaults()`.
 *
 * Design principles (goal §§3,7,8,9,26):
 * - Memories are NOT generic blobs: they carry type, scope, confidence,
 *   importance, topics/entities, provenance, expiry, confirmation status,
 *   and proactive relevance.
 * - Explicit statements > repeated behavior > single weak inference.
 * - Scope defaults to the smallest useful value; generalize upward only
 *   when justified.
 * - Secrets are never persisted (see safety.ts).
 */

export type MemoryType =
  | "preference"
  | "habit"
  | "workflow"
  | "goal"
  | "constraint"
  | "decision"
  | "context"
  | "explicit"
  | "inference"
  | "lesson_success"
  | "lesson_failure"
  | "procedural"
  | "project_knowledge"
  | "followed_topic"
  | "recurring_need"
  | "timing_preference"
  | "proactive_accept"
  | "proactive_reject"
  | "pending_followup"
  | "completed_followup"
  | "temporary";

export type MemoryScope =
  | "global_user"
  | "project"
  | "workspace"
  | "task"
  | "workflow"
  | "conversation"
  | "temporary"
  | "proactive_preference"
  | "scheduled_action";

export type ConfirmationStatus = "explicit" | "inferred" | "confirmed" | "contradicted";

export type ActionStatus = "none" | "suggested" | "accepted" | "rejected" | "scheduled" | "completed" | "dismissed" | "paused" | "cancelled";

export interface MemoryMetadata {
  /** Semantic type — what kind of knowledge this is. */
  memoryType?: MemoryType;
  /** Smallest useful scope. Defaults to global_user for user facts. */
  scope?: MemoryScope;
  /** Project/workspace identifier when scope is project/workspace. */
  scopeKey?: string;
  /** Importance 0-1 (how much future work depends on this). */
  importance?: number;
  /** Topic/entity tags for retrieval and dedupe. */
  topics?: string[];
  /** Source conversation/thread id. */
  sourceConversation?: string;
  /** Where this came from: tool name, task id, extraction pass. */
  provenance?: string;
  /** Epoch ms after which this memory is stale and should be reviewed/expired. */
  expiresAt?: number | null;
  /** Epoch ms for next review of low-confidence inferences. */
  reviewAt?: number | null;
  /** Whether the user stated this explicitly or it was inferred. */
  confirmation?: ConfirmationStatus;
  /** 0-1: how relevant this memory is to proactive decisions. */
  proactiveRelevance?: number;
  /** Lifecycle of any proactive action derived from this memory. */
  actionStatus?: ActionStatus;
}

export const MEMORY_TYPE_DEFAULT: MemoryType = "context";
export const MEMORY_SCOPE_DEFAULT: MemoryScope = "global_user";

export function withMemoryDefaults<T extends object>(entry: T & Partial<MemoryMetadata> & { confidence?: number; relevance?: number }): T & Required<Pick<MemoryMetadata, "memoryType" | "scope" | "confirmation" | "actionStatus">> & MemoryMetadata {
  return {
    importance: 0.5,
    topics: [],
    proactiveRelevance: 0,
    expiresAt: null,
    reviewAt: null,
    ...entry,
    memoryType: entry.memoryType ?? MEMORY_TYPE_DEFAULT,
    scope: entry.scope ?? MEMORY_SCOPE_DEFAULT,
    confirmation: entry.confirmation ?? "inferred",
    actionStatus: entry.actionStatus ?? "none",
  } as any;
}

/** Map legacy category strings to the richer MemoryType taxonomy. */
export function categoryToMemoryType(category: string, content: string): MemoryType {
  const c = (category || "").toLowerCase();
  const t = (content || "").toLowerCase();
  if (c === "preference") return "preference";
  if (c === "personal") return /\b(prefer|like|love|hate|concise|detail|format)\b/.test(t) ? "preference" : "explicit";
  if (c === "project" || c === "technology") return "project_knowledge";
  if (c === "decision") return "decision";
  if (c === "pattern") return "habit";
  if (c === "constraint") return "constraint";
  if (c === "goal") return "goal";
  if (/\b(deadline|remind|follow.?up|later|tomorrow|next week)\b/.test(t)) return "pending_followup";
  if (/\b(failed|error|workaround|lesson|learned)\b/.test(t)) return "lesson_failure";
  if (/\b(prefer|always|never|like|hate|favorite|concise|detailed|format)\b/.test(t)) return "preference";
  if (/\b(decided|chose|going with|switched to)\b/.test(t)) return "decision";
  if (/\b(must|can't|cannot|avoid|constraint)\b/.test(t)) return "constraint";
  return "context";
}

/** Confidence model: explicit > repeated > single inference. */
export function confidenceForEvidence(opts: {
  explicit: boolean;
  occurrences: number;
  contradicted?: boolean;
  base?: number;
}): number {
  const base = opts.base ?? 0.5;
  if (opts.contradicted) return Math.max(0.05, base * 0.4);
  if (opts.explicit) return Math.min(0.98, Math.max(base, 0.85));
  if (opts.occurrences >= 3) return Math.min(0.9, Math.max(base, 0.75));
  if (opts.occurrences === 2) return Math.min(0.8, Math.max(base, 0.6));
  return Math.min(0.5, base); // single weak inference stays low
}

/** A memory is expired when expiresAt passed or reviewAt passed with low confidence. */
export function isMemoryExpired(m: { expiresAt?: number | null; reviewAt?: number | null; confidence?: number }, now = Date.now()): boolean {
  if (m.expiresAt && now > m.expiresAt) return true;
  return false;
}

export function isMemoryStale(m: { updatedAt: number; expiresAt?: number | null }, now = Date.now()): boolean {
  if (m.expiresAt && now > m.expiresAt) return true;
  // Temporary memories older than 7 days are stale; others older than 180 days with low use decay.
  const ageDays = (now - m.updatedAt) / 86_400_000;
  return ageDays > 180;
}
