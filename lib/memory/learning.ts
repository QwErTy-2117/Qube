/**
 * Learning — post-task generalization, contradiction resolution, consolidation.
 *
 * §§4-9: after meaningful tasks, evaluate what is worth remembering;
 * generalize specific incidents into reusable principles; resolve
 * contradictions with conditional preferences rather than blind overwrite.
 *
 * All functions here are pure/deterministic so they can be unit-tested
 * without a model. The LLM-facing protocol lives in lib/learning/protocol.ts.
 */

import { confidenceForEvidence, type MemoryScope, type MemoryType, type ConfirmationStatus } from "./memory-schema";

export interface LearningCandidate {
  content: string;
  memoryType: MemoryType;
  scope: MemoryScope;
  scopeKey?: string;
  confidence: number;
  importance: number;
  topics: string[];
  confirmation: ConfirmationStatus;
  reason: string;
}

export interface ExistingMemoryLike {
  id: string;
  content: string;
  category: string;
  confidence: number;
  relevance: number;
  scope?: MemoryScope;
  scopeKey?: string;
  memoryType?: string;
  updatedAt: number;
}

/** Heuristic triggers for "meaningful task" — cheap gate before deeper analysis. */
export function isMeaningfulTask(opts: {
  toolCalls: number;
  filesChanged: number;
  userText: string;
  taskSuccess: boolean;
}): boolean {
  if (!opts.taskSuccess) return opts.toolCalls >= 2; // failures with effort are worth a lesson
  if (opts.toolCalls >= 3 || opts.filesChanged >= 1) return true;
  const t = (opts.userText || "").toLowerCase();
  return /\b(remember|prefer|decided|deadline|remind|every|always|never|project|report|monitor|schedule)\b/.test(t);
}

/**
 * Generalization check (§6): reject memories that merely restate a raw
 * incident when a reusable principle is available.
 *
 * Returns { generalized, principle? }: when the content is overly specific
 * (single URL, exact button, exact error, single date), callers should prefer
 * the extracted principle or widen scope.
 */
export function generalizeContent(content: string): { generalized: string; wasSpecific: boolean; notes: string } {
  const t = content.trim();
  const hasUrl = /https?:\/\/[^\s]+/.test(t);
  const hasExactUi = /\b(click|button) ["'][^"']+["']/.test(t) || /\bbutton [A-Z]\b/.test(t);
  const hasExactError = /\b(error|errno|E[A-Z_]{3,})\s*[:#]?\s*[0-9a-fx-]{3,}/i.test(t) && t.length < 140;
  const hasSingleDate = /\b(september|october|november|december|january|february|march|april|may|june|july|august)\s+\d{1,2}\b/i.test(t) && !/\b(every|weekly|monthly|recurring|deadline)\b/i.test(t);
  const wasSpecific = (hasUrl || hasExactUi || hasExactError || hasSingleDate) && t.length < 220;

  if (!wasSpecific) return { generalized: t, wasSpecific: false, notes: "already general or long enough to carry context" };

  // Extract the underlying strategy: keep the mechanism, drop the instance.
  let principle = t;
  principle = principle.replace(/https?:\/\/[^\s]+/g, "the target site").replace(/\s{2,}/g, " ").trim();
  // Append a generalization cue so future retrieval matches new contexts.
  const cue =
    " [General principle: prefer the reusable strategy over the specific instance; adapt to the current site/data/tool rather than replaying exact steps.]";
  if (!principle.endsWith("]")) principle += cue;
  return { generalized: principle.slice(0, 600), wasSpecific: true, notes: "widened from single instance to reusable strategy" };
}

export type ContradictionResolution =
  | { action: "update"; mergedContent: string; reason: string }
  | { action: "replace"; reason: string }
  | { action: "narrow_scope"; scope: MemoryScope; scopeKey?: string; reason: string }
  | { action: "temporary_exception"; expiresAt: number; reason: string }
  | { action: "keep_both"; reason: string }
  | { action: "weaken"; reason: string };

/**
 * Resolve a new observation against an existing memory (§8).
 * Prefers conditional preferences over erasure:
 * "generally concise, but detailed for technical implementation work."
 */
export function resolveContradiction(
  existing: ExistingMemoryLike,
  newContent: string,
  opts?: { newExplicit?: boolean; contextHint?: string; now?: number },
): ContradictionResolution {
  const now = opts?.now ?? Date.now();
  const e = existing.content.toLowerCase();
  const n = newContent.toLowerCase();
  const newExplicit = opts?.newExplicit ?? false;

  // Temporary exception signals: "just this once", "for now", "today only".
  if (/\b(just this once|for now|today only|temporarily|this time only)\b/.test(n)) {
    return {
      action: "temporary_exception",
      expiresAt: now + 7 * 86_400_000,
      reason: "new observation scoped as temporary exception; existing preference retained",
    };
  }

  // Context-specific signals: "for X", "when Y", "in this project".
  const contextMatch = n.match(/\bfor\s+([a-z0-9 ._-]{3,40})\b/) || n.match(/\bwhen\s+([a-z0-9 ._-]{3,40})\b/);
  if (contextMatch || /\b(in this project|for technical|for work|at work)\b/.test(n)) {
    const key = (opts?.contextHint || contextMatch?.[1] || "context-specific").slice(0, 60);
    return {
      action: "narrow_scope",
      scope: "project",
      scopeKey: key.trim(),
      reason: `conditional preference: keep "${existing.content.slice(0, 80)}" generally, apply new rule for ${key}`,
    };
  }

  // Classic general-vs-specific: existing is general, new asks for detail (or reverse).
  const existingGeneral = /\b(generally|usually|prefer concise|concise answers)\b/.test(e);
  const newSpecific = /\b(detailed|in detail|thorough|technical|deep dive)\b/.test(n);
  if (existingGeneral && newSpecific) {
    return {
      action: "update",
      mergedContent: `Generally prefers concise answers, but prefers detailed explanations for technical implementation work.`,
      reason: "conditional preference merged from general + specific evidence",
    };
  }

  // Explicit new statement overrides old inference.
  if (newExplicit && existing.confidence < 0.7) {
    return { action: "replace", reason: "explicit statement supersedes older inference" };
  }

  // Stale existing with stronger new evidence: update.
  if (now - existing.updatedAt > 90 * 86_400_000 && newExplicit) {
    return { action: "update", mergedContent: newContent, reason: "refreshed stale memory with explicit update" };
  }

  // Default: weaken old, keep both — future evidence decides.
  return { action: "weaken", reason: "conflicting single observation; weaken prior rather than erase" };
}

/** Merge duplicate memories: keep best content, max confidence/importance, union topics. */
export function consolidateGroup<T extends {
  content: string;
  confidence: number;
  relevance: number;
  importance?: number;
  topics?: string[];
  updatedAt: number;
  createdAt: number;
}>(group: T[]): T {
  if (group.length === 1) return group[0];
  const sorted = [...group].sort((a, b) => b.updatedAt - a.updatedAt);
  const newest = sorted[0];
  const bestConf = Math.max(...group.map((g) => g.confidence));
  const bestRel = Math.max(...group.map((g) => g.relevance));
  const bestImp = Math.max(...group.map((g) => g.importance ?? 0.5));
  const topics = [...new Set(group.flatMap((g) => g.topics || []))].slice(0, 8);
  return { ...newest, confidence: Math.min(0.95, bestConf + 0.05), relevance: bestRel, importance: bestImp, topics };
}

/**
 * Preference discovery from a turn (§7): classify explicit vs inferred and
 * assign confidence. Never promote a single weak inference to a fact.
 */
export function inferPreference(userText: string, opts?: { occurrences?: number }): LearningCandidate | null {
  const t = userText.trim();
  if (t.length < 8 || t.length > 800) return null;
  const lower = t.toLowerCase();

  const explicit = /\b(remember|don't forget|my name is|call me|my preferred|please always|please never)\b/.test(lower);
  const preferenceSignal = /\b(prefer|like|love|hate|dislike|favorite|favourite|concise|detailed|brief|format|csv|morning|evening|weekly|daily)\b/.test(lower);
  const workflowSignal = /\b(every|always|each morning|each friday|recurring|routine|workflow)\b/.test(lower);
  if (!explicit && !preferenceSignal && !workflowSignal) return null;

  const occurrences = opts?.occurrences ?? (explicit ? 1 : 1);
  const confidence = confidenceForEvidence({ explicit, occurrences, base: explicit ? 0.9 : 0.45 });
  const memoryType: MemoryType = workflowSignal ? "habit" : explicit && /name|call me/.test(lower) ? "explicit" : "preference";
  const topics = [...new Set(lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 4).slice(0, 5))];
  return {
    content: t.slice(0, 400),
    memoryType,
    scope: "global_user",
    confidence,
    importance: explicit ? 0.8 : 0.55,
    topics,
    confirmation: explicit ? "explicit" : "inferred",
    reason: explicit ? "explicit statement" : "single behavioral signal — low confidence until repeated",
  };
}

/** Extract follow-up/deadline opportunities (§§15-18) without over-inferring. */
export function detectFollowupOpportunity(userText: string): { topic: string; kind: "deadline" | "recurring_hint" | "one_shot" } | null {
  const t = userText.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const deadline = lower.match(/\b(deadline|due)\b.{0,40}(\b\w+day\b|\b\d{1,2}\/\d{1,2}\b|\bnext week\b|\bfriday\b|\bmonday\b)?/);
  if (deadline) return { topic: t.slice(0, 160), kind: "deadline" };
  // Repeated-interest language alone is NOT a recurring request — mark as hint only.
  if (/\b(every (day|week|morning|friday)|daily|weekly|remind me|notify me|keep me (posted|updated))\b/.test(lower)) {
    return { topic: t.slice(0, 160), kind: "recurring_hint" };
  }
  if (/\b(follow.?up|check back|later|tomorrow)\b/.test(lower) && t.length < 300) {
    return { topic: t.slice(0, 160), kind: "one_shot" };
  }
  return null;
}
