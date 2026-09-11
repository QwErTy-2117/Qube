/**
 * Retrieval pipeline (§24) — pure, deterministic, testable.
 *
 * Conceptual pipeline:
 *   task/opportunity -> query construction -> candidate retrieval
 *   -> relevance scoring -> scope filtering -> confidence weighting
 *   -> recency/importance weighting -> auth/preference checks
 *   -> dedupe/consolidation -> bounded context injection
 *
 * This file owns scoring + filtering. Storage (voicemem-core) owns
 * persistence; memory-context owns prompt injection bounds.
 */

import type { MemoryScope } from "./memory-schema";
import { isMemoryExpired } from "./memory-schema";

export interface RankableMemory {
  id: string;
  content: string;
  category: string;
  relevance: number;
  confidence: number;
  updatedAt: number;
  createdAt: number;
  entities?: string[];
  schemas?: string[];
  tokenCount?: number;
  scope?: MemoryScope;
  scopeKey?: string;
  importance?: number;
  topics?: string[];
  memoryType?: string;
  proactiveRelevance?: number;
  expiresAt?: number | null;
  actionStatus?: string;
}

export interface RetrievalQuery {
  text: string;
  /** Active project/workspace key for scope filtering. */
  scopeKey?: string;
  /** Allowed scopes in priority order; memories outside are down-weighted. */
  allowedScopes?: MemoryScope[];
  /** Boost memories relevant to a proactive opportunity. */
  proactiveMode?: boolean;
  /** Max results before token-budget truncation. */
  topK?: number;
  /** Max characters for injected context. */
  maxChars?: number;
}

export interface ScoredMemory {
  memory: RankableMemory;
  score: number;
  reasons: string[];
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function scopeWeight(m: RankableMemory, q: RetrievalQuery): { w: number; reason?: string } {
  const scope = (m.scope || "global_user") as MemoryScope;
  // Expired memories never surface.
  if (isMemoryExpired(m as any)) return { w: 0, reason: "expired" };
  if (!q.scopeKey) {
    // No active project: global memories full weight, project-scoped down-weighted.
    if (scope === "global_user") return { w: 1 };
    if (scope === "project" || scope === "workspace") return { w: 0.45, reason: "out-of-scope project memory" };
    if (scope === "temporary" || scope === "conversation") return { w: 0.5, reason: "narrow scope" };
    return { w: 0.8 };
  }
  // Active project context: matching scopeKey wins, global still useful.
  if (scope === "global_user") return { w: 1 };
  if ((scope === "project" || scope === "workspace") && m.scopeKey === q.scopeKey) {
    return { w: 1.25, reason: "scope match" };
  }
  if ((scope === "project" || scope === "workspace") && m.scopeKey && m.scopeKey !== q.scopeKey) {
    return { w: 0.2, reason: "different project scope" };
  }
  return { w: 0.8 };
}

/** Score one memory against a query. Deterministic; higher is better. */
export function scoreMemory(m: RankableMemory, q: RetrievalQuery, now = Date.now()): ScoredMemory {
  const reasons: string[] = [];
  const qTokens = tokenize(q.text);
  const cTokens = tokenize(m.content);
  const jac = jaccard(qTokens, cTokens);

  // Base: author relevance blended with confidence (favor useful + high-confidence).
  let score = m.relevance * (0.55 + m.confidence * 0.65);
  reasons.push(`base=${score.toFixed(3)} rel=${m.relevance} conf=${m.confidence}`);

  // Text overlap: strong signal for topical relevance.
  score *= 1 + jac * 2.2;
  if (jac > 0.02) reasons.push(`overlap=${jac.toFixed(3)}`);

  // Entity/topic match boost.
  const qLower = q.text.toLowerCase();
  const entities = [...(m.entities || []), ...(m.topics || [])];
  if (entities.some((en) => en && qLower.includes(String(en).toLowerCase()))) {
    score *= 1.3;
    reasons.push("entity-match");
  }
  if ((m.schemas || []).some((s) => qLower.includes(String(s).toLowerCase()))) {
    score *= 1.1;
    reasons.push("schema-match");
  }

  // Scope filtering (§9): smallest useful scope wins.
  const sw = scopeWeight(m, q);
  score *= sw.w;
  if (sw.reason) reasons.push(sw.reason);

  // Confidence weighting: weak single inferences sink unless nothing else matches.
  if (m.confidence < 0.35 && jac < 0.08) {
    score *= 0.5;
    reasons.push("low-confidence penalty");
  }

  // Recency + importance: recent important memories surface; stale decay.
  const ageDays = Math.max(0, (now - m.updatedAt) / 86_400_000);
  const recency = Math.pow(0.96, Math.min(ageDays, 60));
  const importance = 0.7 + (m.importance ?? 0.5) * 0.6;
  score *= (0.6 + recency * 0.4) * importance;
  if (ageDays < 2) {
    score *= 1.12;
    reasons.push("fresh");
  }

  // Proactive mode: boost memories flagged proactively relevant.
  if (q.proactiveMode && (m.proactiveRelevance ?? 0) > 0.4) {
    score *= 1 + (m.proactiveRelevance ?? 0) * 0.8;
    reasons.push("proactive-boost");
  }

  // Token-budget awareness: prefer compressed entries.
  if ((m.tokenCount ?? 0) > 80) {
    score *= 0.92;
    reasons.push("length penalty");
  }

  // Suppressed action states never surface for proactive reuse.
  if (q.proactiveMode && (m.actionStatus === "rejected" || m.actionStatus === "dismissed" || m.actionStatus === "cancelled")) {
    score *= 0.25;
    reasons.push("previously rejected");
  }

  return { memory: m, score, reasons };
}

export function rankMemories(memories: RankableMemory[], q: RetrievalQuery, now = Date.now()): ScoredMemory[] {
  const topK = q.topK ?? 5;
  return memories
    .map((m) => scoreMemory(m, q, now))
    .filter((s) => s.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));
}

/** Deduplicate near-identical memories (Jaccard > 0.82) keeping newest/higher-confidence. */
export function dedupeMemories<T extends { id: string; content: string; confidence: number; updatedAt: number }>(entries: T[]): T[] {
  const kept: T[] = [];
  for (const e of [...entries].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const eTokens = tokenize(e.content);
    const isDup = kept.some((k) => {
      const kTokens = tokenize(k.content);
      const j = jaccard(eTokens, kTokens);
      if (j < 0.82) return false;
      // Keep the higher-confidence / newer one.
      return true;
    });
    if (!isDup) kept.push(e);
    else {
      // If the duplicate has higher confidence, replace the kept twin.
      const idx = kept.findIndex((k) => jaccard(tokenize(k.content), eTokens) >= 0.82);
      if (idx >= 0 && e.confidence > kept[idx].confidence + 0.15) kept[idx] = e;
    }
  }
  return kept;
}

/** Bounded context injection — precision over dumping everything (§24). */
export function toBoundedContext(scored: ScoredMemory[], maxChars = 1600): string {
  if (scored.length === 0) return "";
  const lines: string[] = [];
  let used = 0;
  for (const s of scored) {
    const line = `- ${s.memory.category}: ${s.memory.content} [rel:${s.memory.relevance.toFixed(2)} conf:${s.memory.confidence.toFixed(2)}]`;
    if (used + line.length > maxChars) break;
    used += line.length + 1;
    lines.push(line);
  }
  return lines.join("\n");
}

/** Build retrieval queries from current task + proactive opportunity. */
export function buildQueries(opts: {
  userText: string;
  taskHint?: string;
  projectKey?: string;
  proactiveTopic?: string;
}): RetrievalQuery[] {
  const queries: RetrievalQuery[] = [];
  const base = (opts.userText || opts.taskHint || "").slice(0, 500);
  if (base.trim()) queries.push({ text: base, scopeKey: opts.projectKey, topK: 5 });
  if (opts.proactiveTopic) {
    queries.push({ text: opts.proactiveTopic, scopeKey: opts.projectKey, proactiveMode: true, topK: 5 });
  }
  return queries;
}
