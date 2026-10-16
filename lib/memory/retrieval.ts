/**
 * Retrieval pipeline — the SINGLE ranker for the unified memory system.
 *
 * BM25-lite over stemmed tokens (see ./text) + scope/confidence/recency
 * priors. Deterministic, model-free, testable.
 *
 * API is backward compatible with the previous Jaccard ranker:
 * scoreMemory, rankMemories, dedupeMemories, toBoundedContext,
 * buildQueries, scopeWeight.
 */

import type { MemoryScope } from "./memory-schema";
import { isMemoryExpired } from "./memory-schema";
import { tokenizeStems, jaccardStems, tokenSet } from "./text";

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
  confirmation?: string;
}

export interface RetrievalQuery {
  text: string;
  scopeKey?: string;
  allowedScopes?: MemoryScope[];
  proactiveMode?: boolean;
  topK?: number;
  maxChars?: number;
}

export interface ScoredMemory {
  memory: RankableMemory;
  score: number;
  reasons: string[];
}

export interface CorpusStats {
  df: Map<string, number>;
  docCount: number;
  avgLen: number;
}

const tokenCache = new WeakMap<object, { tokens: string[]; set: Set<string> }>();

function docTokens(m: RankableMemory): { tokens: string[]; set: Set<string> } {
  const cached = tokenCache.get(m);
  if (cached && (cached as { _c?: string })._c === m.content) return cached;
  const extra = [m.category, m.memoryType, ...(m.topics || []), ...(m.entities || [])]
    .filter(Boolean)
    .join(" ");
  const tokens = tokenizeStems(`${m.content} ${extra} ${extra}`); // extra counted twice = field boost
  const entry = { tokens, set: new Set(tokens) };
  (entry as { _c?: string })._c = m.content;
  tokenCache.set(m, entry);
  return entry;
}

/** Build corpus stats (document frequencies) for IDF weighting. */
export function buildCorpusStats(memories: RankableMemory[]): CorpusStats {
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const m of memories) {
    const { set, tokens } = docTokens(m);
    totalLen += tokens.length;
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { df, docCount: Math.max(1, memories.length), avgLen: Math.max(1, totalLen / Math.max(1, memories.length)) };
}

function idf(term: string, stats: CorpusStats | undefined, docCount: number): number {
  if (!stats) return 1;
  const df = stats.df.get(term) ?? 0;
  return Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
}

/** Expand a query token to matching vocab terms: exact + prefix (len>=5). */
function expandToken(qt: string, vocab: Set<string>): Array<{ term: string; weight: number }> {
  if (vocab.has(qt)) return [{ term: qt, weight: 1 }];
  if (qt.length < 5) return [];
  const out: Array<{ term: string; weight: number }> = [];
  for (const v of vocab) {
    if (v.length < 5) continue;
    if (v.startsWith(qt) || qt.startsWith(v)) out.push({ term: v, weight: 0.6 });
  }
  return out.slice(0, 4);
}

export function scopeWeight(m: RankableMemory, q: RetrievalQuery): { w: number; reason?: string } {
  const scope = (m.scope || "global_user") as MemoryScope;
  if (isMemoryExpired(m as { expiresAt?: number | null }, Date.now())) return { w: 0, reason: "expired" };
  if (!q.scopeKey) {
    if (scope === "global_user") return { w: 1 };
    if (scope === "project" || scope === "workspace") return { w: 0.45, reason: "out-of-scope project memory" };
    if (scope === "temporary" || scope === "conversation") return { w: 0.5, reason: "narrow scope" };
    return { w: 0.8 };
  }
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
export function scoreMemory(
  m: RankableMemory,
  q: RetrievalQuery,
  now = Date.now(),
  stats?: CorpusStats,
): ScoredMemory {
  const reasons: string[] = [];
  if (isMemoryExpired(m as { expiresAt?: number | null }, now)) {
    return { memory: m, score: 0, reasons: ["expired"] };
  }
  const qTokens = tokenizeStems(q.text);
  const { tokens: dTokens, set: dSet } = docTokens(m);
  const N = stats?.docCount ?? 1;

  // --- lexical: BM25-lite over expanded query terms ---
  let bm25 = 0;
  let matchedMass = 0;
  let totalMass = 0;
  let matchedTerms = 0;
  if (qTokens.length > 0) {
    const tf = new Map<string, number>();
    for (const t of dTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const avgLen = stats?.avgLen ?? Math.max(1, dTokens.length);
    const k1 = 1.2;
    const b = 0.75;
    for (const qt of qTokens) {
      const w = idf(qt, stats, N);
      totalMass += w;
      const expansions = stats ? expandToken(qt, new Set([...stats.df.keys()])) : [{ term: qt, weight: 1 as number }];
      // Without corpus stats, match exact + prefix against doc tokens directly.
      const exps = stats
        ? expansions
        : dSet.has(qt)
          ? [{ term: qt, weight: 1 }]
          : [...dSet].filter((v) => v.length >= 5 && qt.length >= 5 && (v.startsWith(qt) || qt.startsWith(v))).slice(0, 4).map((term) => ({ term, weight: 0.6 }));
      for (const { term, weight } of exps) {
        const f = tf.get(term) ?? 0;
        if (f <= 0) continue;
        const termIdf = idf(term, stats, N);
        const norm = bm25Term(f, dTokens.length, avgLen, k1, b);
        bm25 += weight * termIdf * norm;
        matchedMass += weight * w;
        matchedTerms++;
        break; // one vocab term per query token
      }
    }
  }
  const lexNorm = bm25 / (bm25 + 1.5);
  const coverage = totalMass > 0 ? matchedMass / totalMass : 0;

  // Entity/topic exact-substring boost (names, tech).
  const qLower = q.text.toLowerCase();
  let entityBoost = 0;
  const entities = [...(m.entities || []), ...(m.topics || [])];
  if (entities.some((en) => en && qLower.includes(String(en).toLowerCase()))) {
    entityBoost = 0.15;
    reasons.push("entity-match");
  }

  // Category intent boost: vague queries ("who am I", "preferences") map to categories.
  let catBoost = 0;
  const cat = (m.category || "").toLowerCase();
  if (/who am i|my name|about me|identity/.test(qLower) && (cat === "personal" || (m.memoryType === "explicit"))) catBoost = 0.2;
  if (/prefer|like|favor|setting/.test(qLower) && (cat === "preference" || m.memoryType === "preference")) catBoost = Math.max(catBoost, 0.15);
  if (/project|stack|tech|work/.test(qLower) && (cat === "project" || cat === "technology" || m.memoryType === "project_knowledge")) catBoost = Math.max(catBoost, 0.12);
  if (/decid|chose|choice/.test(qLower) && (cat === "decision" || m.memoryType === "decision")) catBoost = Math.max(catBoost, 0.12);
  if (catBoost > 0) reasons.push("category-match");

  const textScore = qTokens.length === 0 ? 1 : Math.min(1, 0.6 * lexNorm + 0.4 * coverage + entityBoost + catBoost);
  if (qTokens.length > 0) {
    if (coverage > 0) reasons.push(`overlap=${coverage.toFixed(2)}`);
    // Gate: no lexical evidence and no entity/category signal → not a match.
    if (matchedTerms === 0 && entityBoost === 0 && catBoost === 0) {
      return { memory: m, score: 0, reasons: ["no-match"] };
    }
  }

  // --- prior: relevance × confidence × importance × recency × scope ---
  let prior = m.relevance * (0.55 + m.confidence * 0.65);
  reasons.push(`base=${prior.toFixed(3)}`);
  const sw = scopeWeight(m, q);
  prior *= sw.w;
  if (sw.reason) reasons.push(sw.reason);
  if (m.confidence < 0.35 && coverage < 0.15) {
    prior *= 0.5;
    reasons.push("low-confidence penalty");
  }
  const ageDays = Math.max(0, (now - m.updatedAt) / 86_400_000);
  const confirmed = m.confirmation === "explicit" || m.confirmation === "confirmed" || (m.importance ?? 0.5) >= 0.75;
  const recency = Math.pow(0.96, Math.min(ageDays, 60));
  const recFloor = confirmed ? 0.75 : 0.45;
  const importance = 0.7 + (m.importance ?? 0.5) * 0.6;
  prior *= (recFloor + (1 - recFloor) * recency) * importance;
  if (ageDays < 2) {
    prior *= 1.12;
    reasons.push("fresh");
  }
  if (q.proactiveMode && (m.proactiveRelevance ?? 0) > 0.4) {
    prior *= 1 + (m.proactiveRelevance ?? 0) * 0.8;
    reasons.push("proactive-boost");
  }
  if ((m.tokenCount ?? 0) > 80) {
    prior *= 0.92;
    reasons.push("length penalty");
  }
  if (q.proactiveMode && (m.actionStatus === "rejected" || m.actionStatus === "dismissed" || m.actionStatus === "cancelled")) {
    prior *= 0.25;
    reasons.push("previously rejected");
  }

  const score = qTokens.length === 0 ? prior : prior * (0.15 + 0.85 * textScore);
  return { memory: m, score, reasons };
}

function bm25Term(tf: number, docLen: number, avgLen: number, k1: number, b: number): number {
  return ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLen) / Math.max(1, avgLen))));
}

export function rankMemories(
  memories: RankableMemory[],
  q: RetrievalQuery,
  now = Date.now(),
  opts?: { fallback?: boolean },
): ScoredMemory[] {
  const topK = q.topK ?? 5;
  if (memories.length === 0) return [];
  const stats = buildCorpusStats(memories);
  const scored = memories
    .map((m) => scoreMemory(m, q, now, stats))
    .filter((s) => s.score > 0.02)
    .sort((a, b) => b.score - a.score);
  const out = scored.slice(0, Math.max(1, topK));
  if (out.length > 0 || opts?.fallback === false) return out;
  // Fallback: query had tokens but nothing matched — rank by prior alone
  // so callers that need *something* (empty-query browse, tool fallback)
  // still get the most important entries.
  if (tokenizeStems(q.text).length > 0) {
    return memories
      .map((m) => scoreMemory(m, { ...q, text: "" }, now, stats))
      .filter((s) => s.score > 0.02)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, topK));
  }
  return out;
}

/** Deduplicate near-identical memories (stem Jaccard > 0.82) keeping newest/higher-confidence. */
export function dedupeMemories<T extends { id: string; content: string; confidence: number; updatedAt: number }>(entries: T[]): T[] {
  const kept: T[] = [];
  for (const e of [...entries].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const eTokens = tokenSet(e.content);
    const isDup = kept.some((k) => jaccardStems(eTokens, tokenSet(k.content)) >= 0.82);
    if (!isDup) kept.push(e);
    else {
      const idx = kept.findIndex((k) => jaccardStems(tokenSet(k.content), eTokens) >= 0.82);
      if (idx >= 0 && e.confidence > kept[idx].confidence + 0.15) kept[idx] = e;
    }
  }
  return kept;
}

/** Bounded context injection — precision over dumping everything. */
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
