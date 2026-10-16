/**
 * Unified memory store — the SINGLE implementation for Qube's agent memory.
 *
 * Inspired by pi-observational-memory's tiered design, adapted to a
 * deterministic, model-free core:
 * - Atomic timestamped observations flow into one flat entry pool.
 * - Explicit/confirmed facts are `durable`; single inferences are
 *   `observations` that get reinforced, promoted, or decay-pruned.
 * - Deterministic consolidation bounds the pool (dedupe → expire →
 *   decay-prune with hysteresis), never an LLM.
 * - One write path (`remember`) with safety gate + generalize + dedupe +
 *   contradiction handling, so "my name is Luca" never duplicates
 *   "The user's name is Luca".
 *
 * Efficiency:
 * - globalThis singleton (shared across Next.js route bundles) + mtime/size
 *   freshness check, so cross-route writes are never silently stale.
 * - Serialized atomic writes (tmp + rename, compact JSON) — concurrent
 *   saves can't clobber each other.
 * - Single BM25-lite ranker lives in ./retrieval; no duplicate rankers.
 * - No speculative prefix-cache explosion; retrieval is sub-ms in-memory.
 */

import { readFile, writeFile, rename, stat, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { tokenSet, jaccardStems, normalizeContent, negationMismatch, hasNegationOrOverride, estimateTokens } from "./text";

export type MemoryTier = "observation" | "durable";

export type MemoryEntry = {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  relevance: number;
  confidence: number;
  // tiered-memory extensions
  tier?: MemoryTier;
  hits?: number;
  supersededBy?: string;
  // retrieval helpers (optional, derived)
  entities?: string[];
  topics?: string[];
  tokenCount?: number;
  // legacy compat (optional)
  brain?: "left" | "right" | "cross";
  schemas?: string[];
  stm?: boolean;
  emotion?: string | null;
  // rich metadata
  memoryType?: string;
  scope?: string;
  scopeKey?: string;
  importance?: number;
  sourceConversation?: string;
  provenance?: string;
  expiresAt?: number | null;
  reviewAt?: number | null;
  confirmation?: string;
  proactiveRelevance?: number;
  actionStatus?: string;
};

export type MemoryExtOpts = {
  relevance?: number;
  confidence?: number;
  importance?: number;
  memoryType?: string;
  scope?: string;
  scopeKey?: string;
  topics?: string[];
  sourceConversation?: string;
  provenance?: string;
  expiresAt?: number | null;
  reviewAt?: number | null;
  confirmation?: string;
  proactiveRelevance?: number;
  actionStatus?: string;
};

export type RememberAction = "created" | "reinforced" | "updated" | "superseded";
export type RememberResult = { entry: MemoryEntry; action: RememberAction; superseded: MemoryEntry[] };

const STORE_VERSION = 5;
const MAX_ENTRIES = 500;
const PRUNE_TARGET = 350;
const MAX_CHARS = 400_000;

type StoreState = {
  path: string;
  entries: MemoryEntry[];
  mtimeMs: number;
  size: number;
  loaded: boolean;
  warmupDone: boolean;
  writeQueue: Promise<void>;
  writesSinceConsolidate: number;
};

function globalState(path: string): StoreState {
  const g = globalThis as unknown as { __qube_memory__?: Record<string, StoreState> };
  if (!g.__qube_memory__) g.__qube_memory__ = {};
  const map = g.__qube_memory__;
  if (!map[path]) {
    map[path] = { path, entries: [], mtimeMs: 0, size: -1, loaded: false, warmupDone: false, writeQueue: Promise.resolve(), writesSinceConsolidate: 0 };
  }
  return map[path];
}

function dataFile(): string {
  return join(getDataDir(), ".memory", "memory.json");
}
function legacyDualFile(): string {
  return join(getDataDir(), ".memory", "dual-memory.json");
}
function legacySemanticFile(): string {
  return join(getDataDir(), ".memory", "semantic-memory.json");
}

function ensureDir() {
  try {
    mkdirSync(join(getDataDir(), ".memory"), { recursive: true });
  } catch {}
}

function sanitizeEntry(e: Record<string, unknown>): MemoryEntry {
  const content = String(e.content ?? "");
  const now = Date.now();
  return {
    id: String(e.id ?? `mem_${now}_${Math.random().toString(36).slice(2, 6)}`),
    category: String(e.category ?? "general"),
    content: content.slice(0, 2000),
    createdAt: Number(e.createdAt ?? now),
    updatedAt: Number(e.updatedAt ?? now),
    relevance: e.relevance !== undefined ? Number(e.relevance) : 0.5,
    confidence: e.confidence !== undefined ? Number(e.confidence) : 0.5,
    tier: (e.tier as MemoryTier) || ((e as { stm?: boolean }).stm === false ? "durable" : undefined) || ((e.confirmation === "explicit" || e.confirmation === "confirmed") ? "durable" : "observation"),
    hits: e.hits !== undefined ? Number(e.hits) : 1,
    supersededBy: typeof e.supersededBy === "string" ? (e.supersededBy as string) : undefined,
    entities: Array.isArray(e.entities) ? (e.entities as string[]) : extractEntities(content),
    topics: Array.isArray(e.topics) ? (e.topics as string[]) : [],
    tokenCount: e.tokenCount !== undefined ? Number(e.tokenCount) : estimateTokens(content),
    memoryType: typeof e.memoryType === "string" ? (e.memoryType as string) : undefined,
    scope: typeof e.scope === "string" ? (e.scope as string) : "global_user",
    scopeKey: typeof e.scopeKey === "string" ? (e.scopeKey as string) : undefined,
    importance: e.importance !== undefined ? Number(e.importance) : 0.5,
    sourceConversation: typeof e.sourceConversation === "string" ? (e.sourceConversation as string) : undefined,
    provenance: typeof e.provenance === "string" ? (e.provenance as string) : undefined,
    expiresAt: e.expiresAt !== undefined && e.expiresAt !== null ? Number(e.expiresAt) : null,
    reviewAt: e.reviewAt !== undefined && e.reviewAt !== null ? Number(e.reviewAt) : null,
    confirmation: typeof e.confirmation === "string" ? (e.confirmation as string) : "inferred",
    proactiveRelevance: e.proactiveRelevance !== undefined ? Number(e.proactiveRelevance) : 0,
    actionStatus: typeof e.actionStatus === "string" ? (e.actionStatus as string) : "none",
  };
}

function extractEntities(text: string): string[] {
  const entities: string[] = [];
  const capWords = text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g);
  if (capWords) entities.push(...capWords.slice(0, 5).map((s) => s.trim()));
  const camel = text.match(/\b[a-z]+(?:[A-Z][a-z]+)+\b/g);
  if (camel) entities.push(...camel.slice(0, 3));
  const dotted = text.match(/\b[\w-]+\.[\w.-]+\b/g);
  if (dotted) entities.push(...dotted.slice(0, 3));
  return [...new Set(entities)].slice(0, 5);
}

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadFromDisk(st: StoreState): Promise<void> {
  const data = await readJsonFile(st.path);
  if (data && typeof data === "object" && Array.isArray((data as { entries?: unknown }).entries)) {
    st.entries = ((data as { entries: Record<string, unknown>[] }).entries).map(sanitizeEntry);
    st.loaded = true;
    st.warmupDone = true;
    try {
      const s = await stat(st.path);
      st.mtimeMs = s.mtimeMs;
      st.size = s.size;
    } catch {}
    return;
  }
  // Migrate legacy stores once.
  const merged: MemoryEntry[] = [];
  const dual = await readJsonFile(legacyDualFile());
  if (dual && typeof dual === "object") {
    const d = dual as { left?: Record<string, unknown>[]; right?: Record<string, unknown>[]; cross?: Record<string, unknown>[]; entries?: Record<string, unknown>[] };
    for (const e of [...(d.left || []), ...(d.right || []), ...(d.cross || []), ...((d as { entries?: Record<string, unknown>[] }).entries || [])]) {
      try { merged.push(sanitizeEntry(e)); } catch {}
    }
  }
  const sem = await readJsonFile(legacySemanticFile());
  if (sem && typeof sem === "object" && Array.isArray((sem as { entries?: unknown[] }).entries)) {
    for (const e of (sem as { entries: Record<string, unknown>[] }).entries) {
      try { merged.push(sanitizeEntry(e)); } catch {}
    }
  }
  st.entries = merged;
  st.loaded = true;
  st.warmupDone = true;
  if (merged.length > 0) {
    await persistLocked(st);
    // Rename legacy files to .bak after successful migration (never delete user data outright).
    for (const p of [legacyDualFile(), legacySemanticFile()]) {
      try {
        if (existsSync(p)) await rename(p, `${p}.bak`).catch(() => {});
      } catch {}
    }
  } else {
    try {
      const s = await stat(st.path);
      st.mtimeMs = s.mtimeMs;
      st.size = s.size;
    } catch { st.mtimeMs = 0; st.size = -1; }
  }
}

/** Reload when the file changed under us (other route bundle / process). Cheap stat gate. */
async function ensureFresh(st: StoreState): Promise<void> {
  if (!st.loaded) {
    await loadFromDisk(st);
    return;
  }
  try {
    const s = await stat(st.path);
    if (s.mtimeMs !== st.mtimeMs || s.size !== st.size) {
      await loadFromDisk(st);
    }
  } catch {
    // File deleted externally → treat as cleared.
    if (st.entries.length > 0 || st.size !== -1) {
      st.entries = [];
      st.mtimeMs = 0;
      st.size = -1;
    }
  }
}

async function persistLocked(st: StoreState): Promise<void> {
  ensureDir();
  const tmp = `${st.path}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify({ version: STORE_VERSION, entries: st.entries, savedAt: Date.now() }), "utf-8");
  await rename(tmp, st.path);
  try {
    const s = await stat(st.path);
    st.mtimeMs = s.mtimeMs;
    st.size = s.size;
  } catch {}
}

/** Serialize all mutations through a queue so concurrent saves can't interleave. */
function mutate<T>(fn: (st: StoreState) => Promise<T>): Promise<T> {
  const st = globalState(dataFile());
  const run = st.writeQueue.then(async () => {
    await ensureFresh(st);
    const out = await fn(st);
    return out;
  });
  // Keep the queue alive across failures.
  st.writeQueue = run.then(() => {}, () => {});
  return run;
}

function persistAsync(st: StoreState): Promise<void> {
  const run = st.writeQueue.then(() => persistLocked(st));
  st.writeQueue = run.then(() => {}, () => {});
  return run;
}

// ---------- write path ----------

function extractNameSlot(text: string): string | null {
  const m = text.match(/\b(?:my name is|call me|this is)\s+([A-Z][a-zA-Z'-]+)/i) || text.match(/\buser'?s name is\s+([A-Z][a-zA-Z'-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The single smart write path. Safety gate + generalize + dedupe +
 * contradiction handling. Never creates a near-duplicate.
 */
export async function remember(
  category: string,
  content: string,
  opts: MemoryExtOpts = {},
): Promise<RememberResult> {
  const { checkPersistable, sanitizeCategory, isSensitiveInference } = await import("./safety");
  const gate = checkPersistable(content);
  if (!gate.ok) throw new Error(`Memory not stored: ${gate.reason}`);
  if (isSensitiveInference(content)) throw new Error("Memory not stored: sensitive personal inference blocked");
  const { generalizeContent } = await import("./learning");
  const { generalized } = generalizeContent(content.trim());
  const body = generalized.slice(0, 600);
  if (!body) throw new Error("Memory not stored: empty");
  const safeCategory = sanitizeCategory(category);
  const now = Date.now();

  return mutate(async (st) => {
    const live = st.entries.filter((e) => !e.supersededBy && !(e.expiresAt && now > e.expiresAt));
    const normNew = normalizeContent(body);
    const setNew = tokenSet(body);

    // 1) Exact duplicate → reinforce.
    for (const e of live) {
      if (normalizeContent(e.content) === normNew) {
        reinforce(e, opts, now);
        await persistLocked(st);
        await logWritten(e);
        return { entry: e, action: "reinforced", superseded: [] };
      }
    }

    // 2) Name slot: same slot, different value → supersede; same value → reinforce.
    const newName = extractNameSlot(body);
    if (newName) {
      for (const e of live) {
        if (e.category !== "personal") continue;
        const oldName = extractNameSlot(e.content);
        if (!oldName) continue;
        if (oldName === newName) {
          reinforce(e, opts, now);
          await persistLocked(st);
          await logWritten(e);
          return { entry: e, action: "reinforced", superseded: [] };
        }
        // Different name for the same slot → replace in place (single-valued fact).
        e.content = body;
        e.updatedAt = now;
        e.confidence = Math.max(opts.confidence ?? 0.9, e.confidence);
        e.confirmation = opts.confirmation || "explicit";
        e.tier = "durable";
        e.hits = (e.hits || 1) + 1;
        e.entities = extractEntities(body);
        await persistLocked(st);
        await logWritten(e);
        return { entry: e, action: "updated", superseded: [] };
      }
    }

    // 3) Near-duplicate (stem Jaccard ≥ 0.8, no negation flip) → reinforce.
    let best: { e: MemoryEntry; j: number } | null = null;
    for (const e of live) {
      if (e.scope !== (opts.scope || e.scope)) continue;
      const j = jaccardStems(setNew, tokenSet(e.content));
      if (j >= 0.8 && !negationMismatch(body, e.content)) {
        if (!best || j > best.j) best = { e, j };
      }
    }
    if (best) {
      const e = best.e;
      const wasLen = e.content.length;
      reinforce(e, opts, now);
      // Prefer the longer, more explicit wording.
      if (body.length > wasLen * 1.2) {
        e.content = body;
        e.entities = extractEntities(body);
      }
      // Merge topics.
      if (opts.topics?.length) e.topics = [...new Set([...(e.topics || []), ...opts.topics])].slice(0, 8);
      await persistLocked(st);
      await logWritten(e);
      return { entry: e, action: "reinforced", superseded: [] };
    }

    // 4) Contradiction candidate: same category + overlap ≥ 0.5 + override cue.
    {
      const cands = live
        .filter((e) => e.category === safeCategory)
        .map((e) => ({ e, j: jaccardStems(setNew, tokenSet(e.content)) }))
        .filter((c) => c.j >= 0.5 && c.j < 0.8)
        .sort((a, b) => b.j - a.j)
        .slice(0, 3);
      const explicit = (opts.confirmation === "explicit") || /\b(remember|my name is|call me|prefer|decided|don't|do not|never|always)\b/i.test(body);
      if (cands.length > 0 && (explicit || hasNegationOrOverride(body))) {
        const { resolveContradiction } = await import("./learning");
        const top = cands[0].e;
        const resolution = resolveContradiction(top as never, body, { newExplicit: explicit });
        if (resolution.action === "update" && "mergedContent" in resolution) {
          top.content = (resolution.mergedContent as string).slice(0, 600);
          top.updatedAt = now;
          top.confidence = Math.max(opts.confidence ?? 0.6, top.confidence);
          top.entities = extractEntities(top.content);
          top.tier = "durable";
          await persistLocked(st);
          await logWritten(top);
          return { entry: top, action: "updated", superseded: [] };
        }
        if (resolution.action === "replace") {
          const created = insertEntry(st, safeCategory, body, opts, now);
          top.supersededBy = created.id;
          top.relevance = Math.min(top.relevance, 0.1);
          top.updatedAt = now;
          st.entries.push(created);
          await afterInsert(st);
          await persistLocked(st);
          await logWritten(created);
          return { entry: created, action: "superseded", superseded: [top] };
        }
        if (resolution.action === "narrow_scope" || resolution.action === "temporary_exception") {
          const scope = resolution.action === "narrow_scope" ? (resolution as { scope: string }).scope : opts.scope;
          const created = insertEntry(st, safeCategory, body, { ...opts, scope: (scope as string) || opts.scope }, now);
          if (resolution.action === "temporary_exception") {
            created.expiresAt = (resolution as { expiresAt: number }).expiresAt;
            created.memoryType = "temporary";
          }
          st.entries.push(created);
          await afterInsert(st);
          await persistLocked(st);
          await logWritten(created);
          return { entry: created, action: "created", superseded: [] };
        }
        // weaken / keep_both → fall through to plain insert (weaken old slightly).
        if (resolution.action === "weaken") {
          top.relevance = Math.max(0.1, top.relevance * 0.6);
        }
      }
    }

    const created = insertEntry(st, safeCategory, body, opts, now);
    st.entries.push(created);
    await afterInsert(st);
    await persistLocked(st);
    await logWritten(created);
    return { entry: created, action: "created", superseded: [] };
  });
}

function reinforce(e: MemoryEntry, opts: MemoryExtOpts, now: number): void {
  e.hits = (e.hits || 1) + 1;
  e.confidence = Math.min(0.92, Math.max(e.confidence, opts.confidence ?? 0.5) + 0.05);
  e.relevance = Math.max(e.relevance, opts.relevance ?? e.relevance);
  e.importance = Math.max(e.importance ?? 0.5, opts.importance ?? 0.5);
  e.updatedAt = now;
  if ((e.hits || 0) >= 2 || e.confirmation === "explicit" || e.confirmation === "confirmed") e.tier = "durable";
  if (opts.confirmation) e.confirmation = opts.confirmation;
  if (opts.memoryType) e.memoryType = opts.memoryType;
}

function insertEntry(st: StoreState, category: string, body: string, opts: MemoryExtOpts, now: number): MemoryEntry {
  void st;
  const explicit = opts.confirmation === "explicit" || opts.confirmation === "confirmed";
  return {
    id: `mem_${now}_${Math.random().toString(36).slice(2, 6)}`,
    category,
    content: body,
    createdAt: now,
    updatedAt: now,
    relevance: opts.relevance ?? 0.6,
    confidence: opts.confidence ?? opts.relevance ?? 0.6,
    tier: explicit ? "durable" : "observation",
    hits: 1,
    entities: extractEntities(body),
    topics: opts.topics || [],
    tokenCount: estimateTokens(body),
    memoryType: opts.memoryType,
    scope: opts.scope || "global_user",
    scopeKey: opts.scopeKey,
    importance: opts.importance ?? (explicit ? 0.8 : 0.5),
    sourceConversation: opts.sourceConversation,
    provenance: opts.provenance,
    expiresAt: opts.expiresAt ?? null,
    reviewAt: opts.reviewAt ?? null,
    confirmation: opts.confirmation || "inferred",
    proactiveRelevance: opts.proactiveRelevance ?? 0,
    actionStatus: opts.actionStatus || "none",
  };
}

async function logWritten(e: MemoryEntry): Promise<void> {
  try {
    const { logMemoryWritten } = await import("@/lib/agent/observability");
    await logMemoryWritten(e.sourceConversation || "memory", e.id, e.category, `stored (${e.memoryType || "context"})`);
  } catch {}
}

async function afterInsert(st: StoreState): Promise<void> {
  st.writesSinceConsolidate++;
  const chars = st.entries.reduce((n, e) => n + e.content.length, 0);
  if (st.entries.length > MAX_ENTRIES || chars > MAX_CHARS) {
    await consolidateLocked(st);
    st.writesSinceConsolidate = 0;
  } else if (st.writesSinceConsolidate >= 20) {
    // Opportunistic expiry sweep (cheap) — full consolidate only when over budget.
    const now = Date.now();
    const before = st.entries.length;
    st.entries = st.entries.filter((e) => !(e.expiresAt && now > e.expiresAt));
    if (st.entries.length !== before) st.writesSinceConsolidate = 0;
    else st.writesSinceConsolidate = 0;
  }
}

// ---------- public API (backward compatible) ----------

export async function warmup(): Promise<void> {
  const st = globalState(dataFile());
  await ensureFresh(st);
}

export async function addMemoryEntry(category: string, content: string, relevance = 0.5, confidence?: number): Promise<MemoryEntry> {
  const { entry } = await remember(category, content, { relevance, confidence });
  return entry;
}

export async function addMemoryEntryExt(category: string, content: string, opts: MemoryExtOpts = {}): Promise<MemoryEntry> {
  const { entry } = await remember(category, content, opts);
  return entry;
}

/** Explicit filtered search: scope/type/confidence-aware, bounded, strict (no-match → []). */
export async function searchMemories(opts: {
  query: string;
  scope?: string;
  scopeKey?: string;
  memoryType?: string;
  category?: string;
  minConfidence?: number;
  topK?: number;
}): Promise<MemoryEntry[]> {
  const st = globalState(dataFile());
  await ensureFresh(st);
  const now = Date.now();
  let pool = st.entries.filter((e) => !e.supersededBy && !(e.expiresAt && now > e.expiresAt));
  if (opts.scope) pool = pool.filter((e) => (e.scope || "global_user") === opts.scope);
  if (opts.scopeKey) {
    pool = pool.filter((e) => {
      const s = e.scope || "global_user";
      if (s === "global_user") return true;
      if (s === "project" || s === "workspace") return (e.scopeKey || "") === opts.scopeKey;
      return true;
    });
  }
  if (opts.memoryType) pool = pool.filter((e) => (e.memoryType || "context") === opts.memoryType);
  if (opts.category) pool = pool.filter((e) => e.category === opts.category);
  if (opts.minConfidence !== undefined) pool = pool.filter((e) => e.confidence >= opts.minConfidence!);
  if (!opts.query?.trim()) {
    // Browse mode: top by prior.
    const { rankMemories } = await import("./retrieval");
    return rankMemories(pool as never, { text: "", scopeKey: opts.scopeKey, topK: opts.topK ?? 8 } as never, now).map((r) => r.memory as MemoryEntry);
  }
  const { rankMemories } = await import("./retrieval");
  const ranked = rankMemories(pool as never, { text: opts.query, scopeKey: opts.scopeKey, topK: opts.topK ?? 8 } as never, now, { fallback: false });
  return ranked.map((r) => r.memory as MemoryEntry);
}

/** Top entries by prior (importance × confidence × recency) — browse mode. */
export async function getTopEntries(topK = 8, scopeKey?: string): Promise<MemoryEntry[]> {
  return searchMemories({ query: "", topK, scopeKey });
}

export async function getMemoryEntries(category?: string): Promise<MemoryEntry[]> {
  const st = globalState(dataFile());
  await ensureFresh(st);
  const all = [...st.entries].sort((a, b) => b.updatedAt - a.updatedAt);
  if (category) return all.filter((e) => e.category === category);
  return all;
}

export async function deleteMemoryEntry(id: string): Promise<boolean> {
  return mutate(async (st) => {
    const before = st.entries.length;
    st.entries = st.entries.filter((e) => e.id !== id);
    if (st.entries.length === before) return false;
    await persistLocked(st);
    return true;
  });
}

export async function updateMemoryEntry(id: string, updates: Partial<Pick<MemoryEntry, "content" | "category" | "relevance" | "confidence" | "importance" | "scope" | "scopeKey" | "memoryType" | "topics" | "confirmation" | "proactiveRelevance" | "actionStatus" | "expiresAt" | "reviewAt">>): Promise<boolean> {
  return mutate(async (st) => {
    const entry = st.entries.find((e) => e.id === id);
    if (!entry) return false;
    if (updates.content !== undefined) {
      const { checkPersistable } = await import("./safety");
      const gate = checkPersistable(updates.content);
      if (!gate.ok) return false;
      entry.content = updates.content.slice(0, 2000);
      entry.entities = extractEntities(updates.content);
      entry.tokenCount = estimateTokens(updates.content);
    }
    if (updates.category !== undefined) entry.category = updates.category;
    if (updates.relevance !== undefined) entry.relevance = updates.relevance;
    if (updates.confidence !== undefined) entry.confidence = updates.confidence;
    if (updates.importance !== undefined) entry.importance = updates.importance;
    if (updates.scope !== undefined) entry.scope = updates.scope;
    if (updates.scopeKey !== undefined) entry.scopeKey = updates.scopeKey;
    if (updates.memoryType !== undefined) entry.memoryType = updates.memoryType;
    if (updates.topics !== undefined) entry.topics = updates.topics;
    if (updates.confirmation !== undefined) entry.confirmation = updates.confirmation;
    if (updates.proactiveRelevance !== undefined) entry.proactiveRelevance = updates.proactiveRelevance;
    if (updates.actionStatus !== undefined) entry.actionStatus = updates.actionStatus;
    if (updates.expiresAt !== undefined) entry.expiresAt = updates.expiresAt;
    if (updates.reviewAt !== undefined) entry.reviewAt = updates.reviewAt;
    entry.updatedAt = Date.now();
    await persistLocked(st);
    return true;
  });
}

export async function replaceAllEntries(entries: MemoryEntry[]): Promise<void> {
  await mutate(async (st) => {
    st.entries = entries.map((e) => sanitizeEntry(e as unknown as Record<string, unknown>));
    await persistLocked(st);
  });
}

export async function clearMemory(): Promise<void> {
  await mutate(async (st) => {
    st.entries = [];
    await persistLocked(st);
  });
  // Best-effort: remove legacy files too so a reset is total.
  for (const p of [legacyDualFile(), legacySemanticFile(), `${legacyDualFile()}.bak`, `${legacySemanticFile()}.bak`]) {
    try { if (existsSync(p)) await unlink(p).catch(() => {}); } catch {}
  }
}

/** Deterministic consolidation: expire → drop old superseded → dedupe → decay-prune. */
export async function consolidateMemories(): Promise<{ merged: number; total: number }> {
  return mutate(async (st) => {
    const res = await consolidateLocked(st);
    await persistLocked(st);
    return res;
  });
}

async function consolidateLocked(st: StoreState): Promise<{ merged: number; total: number }> {
  const now = Date.now();
  let merged = 0;
  // 1) Expired out.
  const beforeExp = st.entries.length;
  st.entries = st.entries.filter((e) => !(e.expiresAt && now > e.expiresAt));
  merged += beforeExp - st.entries.length;
  // 2) Old superseded tombstones out (>7d).
  const beforeSup = st.entries.length;
  st.entries = st.entries.filter((e) => !e.supersededBy || now - e.updatedAt < 7 * 86_400_000);
  merged += beforeSup - st.entries.length;
  // 3) Near-duplicate merge (blocked by first two stems to stay O(n·k)).
  try {
    const { dedupeMemories } = await import("./retrieval");
    const { consolidateGroup } = await import("./learning");
    const blocks = new Map<string, MemoryEntry[]>();
    for (const e of st.entries) {
      const stems = [...tokenSet(e.content)].sort().slice(0, 2).join("|") || e.category;
      const arr = blocks.get(stems) || [];
      arr.push(e);
      blocks.set(stems, arr);
    }
    const kept: MemoryEntry[] = [];
    for (const g of blocks.values()) {
      if (g.length === 1) { kept.push(g[0]); continue; }
      const deduped = dedupeMemories(g as never[]) as unknown as MemoryEntry[];
      merged += g.length - deduped.length;
      for (const d of deduped) {
        if (g.length - deduped.length >= 1) d.confidence = Math.min(0.92, d.confidence + 0.05);
        d.hits = Math.max(d.hits || 1, 1) + (g.length - deduped.length > 0 ? 1 : 0);
      }
      // True twins (same 60-char prefix) → consolidateGroup merge.
      if (deduped.length > 1) {
        const used = new Set<string>();
        for (const e of deduped) {
          if (used.has(e.id)) continue;
          const twins = deduped.filter((o) => !used.has(o.id) && o.content.toLowerCase().slice(0, 60) === e.content.toLowerCase().slice(0, 60));
          twins.forEach((t) => used.add(t.id));
          if (twins.length > 1) {
            kept.push(consolidateGroup(twins as never[]) as unknown as MemoryEntry);
            merged += twins.length - 1;
          } else kept.push(e);
        }
      } else kept.push(...deduped);
    }
    st.entries = kept;
  } catch {}
  // 4) Decay-prune past budget (protect explicit/confirmed/important/reinforced).
  const chars = st.entries.reduce((n, e) => n + e.content.length, 0);
  if (st.entries.length > MAX_ENTRIES || chars > MAX_CHARS) {
    const scored = st.entries.map((e) => {
      const ageDays = Math.max(0, (now - e.updatedAt) / 86_400_000);
      const protected_ = e.confirmation === "explicit" || e.confirmation === "confirmed" || (e.importance ?? 0.5) >= 0.7 || (e.hits || 1) >= 3;
      const value = (e.importance ?? 0.5) * 0.4 + e.confidence * 0.3 + Math.pow(0.96, Math.min(ageDays, 60)) * 0.3;
      return { e, value, protected_ };
    });
    const victimCount = Math.max(st.entries.length - PRUNE_TARGET, 0);
    if (victimCount > 0) {
      const victims = scored.filter((s) => !s.protected_).sort((a, b) => a.value - b.value).slice(0, victimCount).map((s) => s.e.id);
      const victimSet = new Set(victims);
      // If protected entries alone exceed target, drop oldest protected observations too.
      let drop = st.entries.filter((e) => !victimSet.has(e.id));
      if (drop.length > PRUNE_TARGET) {
        const extra = drop.filter((e) => e.tier === "observation").sort((a, b) => a.updatedAt - b.updatedAt).slice(0, drop.length - PRUNE_TARGET);
        for (const x of extra) victimSet.add(x.id);
        drop = st.entries.filter((e) => !victimSet.has(e.id));
      }
      merged += st.entries.length - drop.length;
      st.entries = drop;
    }
  }
  return { merged, total: st.entries.length };
}

// ---------- read helpers ----------

export async function getRelevantContext(query?: string, opts?: { scopeKey?: string; proactiveMode?: boolean }): Promise<string> {
  const { toBoundedContext, rankMemories } = await import("./retrieval");
  const st = globalState(dataFile());
  await ensureFresh(st);
  const now = Date.now();
  const pool = st.entries.filter((e) => !e.supersededBy && !(e.expiresAt && now > e.expiresAt));
  if (pool.length === 0) return "";
  const ranked = query?.trim()
    ? rankMemories(pool as never, { text: query, scopeKey: opts?.scopeKey, proactiveMode: opts?.proactiveMode, topK: 5 } as never, now, { fallback: false })
    : rankMemories(pool as never, { text: "", scopeKey: opts?.scopeKey, proactiveMode: opts?.proactiveMode, topK: 5 } as never, now);
  return toBoundedContext(ranked, 1600);
}

export async function getRelevantContextSemantic(query: string): Promise<string> {
  return getRelevantContext(query);
}

export async function prefetchQuery(_partial: string): Promise<void> {
  // Retrieval is sub-ms in-memory; prefetch = warm the store only.
  await warmup().catch(() => {});
}

export function getPrefetchCacheSize(): number { return 0; }
export function isWarmedUp(): boolean {
  try { return globalState(dataFile()).warmupDone; } catch { return false; }
}

export async function getMemoryStats(): Promise<{
  total: number; byCategory: Record<string, number>; observations: number; durable: number;
  tokens: number; warmedUp: boolean;
  left: number; right: number; cross: number; stm: number; ltm: number; prefetchCache: number;
}> {
  const st = globalState(dataFile());
  await ensureFresh(st);
  const byCategory: Record<string, number> = {};
  let observations = 0;
  let durable = 0;
  let tokens = 0;
  for (const e of st.entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    if (e.tier === "durable") durable++;
    else observations++;
    tokens += estimateTokens(e.content);
  }
  return {
    total: st.entries.length, byCategory, observations, durable, tokens, warmedUp: st.warmupDone,
    left: st.entries.length, right: 0, cross: 0, stm: observations, ltm: durable, prefetchCache: 0,
  };
}

/** Compat: previous dual-brain shape derived from the flat pool. */
export async function getDualStore(): Promise<{ left: MemoryEntry[]; right: MemoryEntry[]; cross: MemoryEntry[]; version: number }> {
  const entries = await getMemoryEntries();
  return { left: entries, right: [], cross: [], version: STORE_VERSION };
}

export async function detectContradictions(newContent: string, threshold = 0.35): Promise<Array<{ entry: MemoryEntry; overlap: number; reason: string }>> {
  const st = globalState(dataFile());
  await ensureFresh(st);
  if (st.entries.length === 0) return [];
  const setNew = tokenSet(newContent);
  const results: Array<{ entry: MemoryEntry; overlap: number; reason: string }> = [];
  for (const e of st.entries) {
    if (e.supersededBy) continue;
    const j = jaccardStems(setNew, tokenSet(e.content));
    if (j > threshold) {
      const lower = newContent.toLowerCase();
      const hasNeg = lower.includes(" not ") || lower.includes(" no longer ") || lower.includes(" instead ") || lower.includes(" switched ") || lower.includes(" changed ") || lower.includes(" now ");
      const reason = hasNeg ? "negation/override" : j > 0.5 ? "high overlap supersession" : "overlap supersession candidate";
      results.push({ entry: e, overlap: j, reason: hasNeg || j > 0.5 ? reason : `${reason} (weak)` });
    }
  }
  results.sort((a, b) => b.overlap - a.overlap);
  return results;
}

export async function upsertMemoryWithContradictionCheck(category: string, content: string, relevance = 0.6, confidence?: number): Promise<{ entry: MemoryEntry; superseded: MemoryEntry[] }> {
  return remember(category, content, { relevance, confidence });
}

// Test helper: reset in-process cache for the current data dir (tests use isolated dirs per file).
export function __resetForTests(): void {
  try {
    const g = globalThis as unknown as { __qube_memory__?: Record<string, StoreState> };
    if (g.__qube_memory__) delete g.__qube_memory__[dataFile()];
  } catch {}
}
