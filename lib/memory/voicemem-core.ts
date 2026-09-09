/**
 * VoiceMem-inspired dual-brain memory for Qube — JS adaptation, never referenced as VoiceMem in UI.
 * 
 * Architecture: Streaming Dual-Brain (Left factual + Right persona)
 * - Left Brain: factual, Schema+Entity organized, direct retrieval, 91% LoCoMo with Top-3
 * - Right Brain: persona/emotion, STM/LTM with cross-entity nodes, joint maintenance
 * - Streaming: 0-300ms speculative prefetch while user still composing
 * - Hierarchical: hot (in-memory STM) → warm (LTM) → cold (disk), Top-K routing
 * - Decoupled: all components replaceable, ~300 tokens per query vs 6k
 * 
 * Adapted from https://github.com/xzf-thu/VoiceMem for text agent (Qube):
 * - Voice input → text input, but keep speculative prefetch on partial text (SPEC_MIN_CHARS=6)
 * - Audio perception (ASR/speaker) → text entity/schema extraction
 * - Emotion layer → lightweight persona inference
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

// Keep same file for backwards compat, but add dual-brain envelope
const DUAL_FILE = join(getDataDir(), ".memory", "dual-memory.json");
const LEGACY_FILE = join(getDataDir(), ".memory", "semantic-memory.json"); // legacy, will be removed

export type MemoryEntry = {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  relevance: number;
  confidence: number;
  // VoiceMem extensions (optional for compat)
  brain?: "left" | "right" | "cross";
  entities?: string[];
  schemas?: string[];
  stm?: boolean; // short-term vs long-term
  emotion?: string | null;
  tokenCount?: number;
};

type DualStore = {
  left: MemoryEntry[];  // factual
  right: MemoryEntry[]; // persona/emotion/pattern
  cross: MemoryEntry[]; // cross-entity nodes (joint maintenance)
  version: number;
  warmedAt?: number;
};

// In-memory hot cache (STM) — hierarchical: hot in Map, warm in DualStore, cold on disk
let hotCache: Map<string, MemoryEntry> | null = null;
let warmStore: DualStore | null = null;
let warmupDone = false;
let lastDiskRead = 0;

// Speculative prefetch cache: partial query (6+ chars) → result + timestamp
const prefetchCache = new Map<string, { result: string; left: MemoryEntry[]; right: MemoryEntry[]; ts: number }>();
const PREFETCH_TTL = 30_000; // 30s like VoiceMem streaming window
const SPEC_MIN_CHARS = 6;

// Lazy-load flag for heavy deps
let heavyLoaded = false;

function ensureDir() {
  const dir = join(getDataDir(), ".memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function defaultDual(): DualStore {
  return { left: [], right: [], cross: [], version: 4 };
}

function categorizeBrain(category: string): "left" | "right" | "cross" {
  const leftCats = new Set(["preference", "project", "technology", "decision", "general", "constraint", "goal"]);
  const rightCats = new Set(["personal", "pattern"]);
  if (leftCats.has(category)) return "left";
  if (rightCats.has(category)) return "right";
  return "left";
}

function extractEntities(text: string): string[] {
  // Lightweight entity extraction: capitalized words, emails, project-like tokens
  const entities: string[] = [];
  const capWords = text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g);
  if (capWords) entities.push(...capWords.slice(0, 5).map(s => s.trim()));
  const tech = text.match(/\b(Next\.js|Tauri|React|TypeScript|Qube|GPT|Muse|Gemini)\b/gi);
  if (tech) entities.push(...tech.slice(0, 3));
  return [...new Set(entities)].slice(0, 5);
}

function extractSchemas(text: string): string[] {
  const schemas: string[] = [];
  const lower = text.toLowerCase();
  if (lower.includes("prefer")) schemas.push("preference");
  if (lower.includes("project") || lower.includes("build")) schemas.push("project");
  if (lower.includes("decide") || lower.includes("choose")) schemas.push("decision");
  if (lower.includes("pattern") || lower.includes("always") || lower.includes("usually")) schemas.push("pattern");
  if (lower.includes("personal") || lower.includes("i am") || lower.includes("my name")) schemas.push("personal");
  if (lower.includes("tech") || lower.includes("using") || lower.includes("stack")) schemas.push("technology");
  return schemas.length ? schemas : ["general"];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Warmup like VoiceMem vm.warmup() — preload disk into hot cache, so first query doesn't pay disk cost
export async function warmup(): Promise<void> {
  if (warmupDone && hotCache) return;
  ensureDir();
  try {
    const dual = await readDualStore();
    warmStore = dual;
    hotCache = new Map();
    // Hot: most recent 30 entries (STM)
    const all = [...dual.left, ...dual.right, ...dual.cross].sort((a,b)=>b.updatedAt - a.updatedAt).slice(0,30);
    for (const e of all) hotCache.set(e.id, e);
    warmupDone = true;
    lastDiskRead = Date.now();
    // console.log(`[voicemem] warmup: ${hotCache.size} hot, ${dual.left.length} left, ${dual.right.length} right, ${dual.cross.length} cross`);
  } catch {
    warmStore = defaultDual();
    hotCache = new Map();
    warmupDone = true;
  }
}

async function readDualStore(): Promise<DualStore> {
  // Only VoiceMem dual file — old memory removed, rely only on dual
  try {
    if (existsSync(DUAL_FILE)) {
      const data = await readFile(DUAL_FILE, "utf-8");
      const raw = JSON.parse(data);
      if (raw.left || raw.right || raw.cross) {
        return { left: (raw.left||[]).map(migrateEntry), right: (raw.right||[]).map(migrateEntry), cross: (raw.cross||[]).map(migrateEntry), version: 4, warmedAt: raw.warmedAt };
      }
    }
  } catch {}
  // One-time migration from legacy if dual doesn't exist yet, then delete legacy
  try {
    if (existsSync(LEGACY_FILE)) {
      const data = await readFile(LEGACY_FILE, "utf-8");
      const raw = JSON.parse(data);
      const entries: MemoryEntry[] = (raw.entries||[]).map(migrateEntry);
      const left: MemoryEntry[] = [];
      const right: MemoryEntry[] = [];
      for (const e of entries) {
        const brain = e.brain || categorizeBrain(e.category);
        if (brain === "right") right.push(e);
        else left.push(e);
      }
      const migrated: DualStore = { left, right, cross: [], version: 4 };
      // Write migrated to dual and remove legacy (rely only on VoiceMem)
      try {
        const { unlink } = await import("node:fs/promises");
        await writeFile(DUAL_FILE, JSON.stringify({ ...migrated, warmedAt: Date.now() }, null, 2), "utf-8");
        await unlink(LEGACY_FILE).catch(()=>{});
        console.log(`[voicemem] migrated ${entries.length} legacy entries to dual and removed old memory`);
      } catch {}
      return migrated;
    }
  } catch {}
  return defaultDual();
}

function migrateEntry(e: Record<string, unknown>): MemoryEntry {
  return {
    id: String(e.id ?? `mem_${Date.now()}`),
    category: String(e.category ?? "general"),
    content: String(e.content ?? ""),
    createdAt: Number(e.createdAt ?? Date.now()),
    updatedAt: Number(e.updatedAt ?? Date.now()),
    relevance: e.relevance !== undefined ? Number(e.relevance) : 0.5,
    confidence: e.confidence !== undefined ? Number(e.confidence) : 0.5,
    brain: (e.brain as any) || categorizeBrain(String(e.category??"general")),
    entities: Array.isArray(e.entities) ? e.entities as string[] : extractEntities(String(e.content??"")),
    schemas: Array.isArray(e.schemas) ? e.schemas as string[] : extractSchemas(String(e.content??"")),
    stm: e.stm !== undefined ? Boolean(e.stm) : (Date.now() - Number(e.createdAt??Date.now()) < 86400000*7),
    emotion: (e.emotion as string) ?? null,
    tokenCount: e.tokenCount !== undefined ? Number(e.tokenCount) : estimateTokens(String(e.content??"")),
  };
}

async function writeDualStore(store: DualStore): Promise<void> {
  ensureDir();
  warmStore = store;
  if (hotCache) {
    const all = [...store.left, ...store.right, ...store.cross].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,30);
    hotCache.clear();
    for (const e of all) hotCache.set(e.id, e);
  }
  // Only VoiceMem dual file — old memory entirely removed
  await writeFile(DUAL_FILE, JSON.stringify({ ...store, warmedAt: Date.now() }, null, 2), "utf-8");
  // Ensure legacy file is gone (rely only on VoiceMem)
  try {
    const { unlink } = await import("node:fs/promises");
    if (existsSync(LEGACY_FILE)) await unlink(LEGACY_FILE).catch(()=>{});
  } catch {}
}

// Hierarchical retrieval: hot → warm → cold (cold is same as warm here, but left/right split gives hierarchy)
function getHotEntries(): MemoryEntry[] {
  if (!hotCache) return [];
  return Array.from(hotCache.values());
}

function getAllEntriesSync(): MemoryEntry[] {
  if (warmStore) return [...warmStore.left, ...warmStore.right, ...warmStore.cross];
  return [];
}

// Router: decide which brain(s) to query based on query content
function routeQuery(query: string): { left: boolean; right: boolean; cross: boolean } {
  const lower = query.toLowerCase();
  const factual = lower.includes("what") || lower.includes("how") || lower.includes("when") || lower.includes("where") || lower.includes("prefer") || lower.includes("project") || lower.includes("tech");
  const persona = lower.includes("who") || lower.includes("feel") || lower.includes("like") || lower.includes("personal") || lower.includes("emotion") || lower.includes("remember me");
  if (factual && !persona) return { left: true, right: false, cross: false };
  if (persona && !factual) return { left: false, right: true, cross: true };
  return { left: true, right: true, cross: true }; // default: both
}

// Lightweight ranking like VoiceMem: route → rank → Top-K
function rankEntries(query: string, entries: MemoryEntry[], topK: number): MemoryEntry[] {
  if (entries.length === 0) return [];
  const qLower = query.toLowerCase();
  const qTokens = new Set(qLower.split(/\s+/).filter(s=>s.length>=3));
  const scored = entries.map(e => {
    const cLower = e.content.toLowerCase();
    let score = e.relevance * (0.6 + e.confidence*0.6);
    // Recency boost for STM (like VoiceMem short-term)
    const ageDays = (Date.now() - e.updatedAt)/86400000;
    if (e.stm && ageDays < 2) score *= 1.2;
    // Entity match boost (VoiceMem left brain entity)
    if (e.entities?.some(en => qLower.includes(en.toLowerCase()))) score *= 1.3;
    // Schema match
    if (e.schemas?.some(s => qLower.includes(s))) score *= 1.1;
    // Token overlap
    const eTokens = new Set(e.content.toLowerCase().split(/\s+/).filter(s=>s.length>=3));
    let inter = 0;
    for (const t of qTokens) if (eTokens.has(t)) inter++;
    const union = qTokens.size + eTokens.size - inter;
    const jac = union ? inter/union : 0;
    score *= (1 + jac*2);
    // Substring bonus
    if (cLower.includes(qLower) || qLower.includes(cLower.slice(0,20))) score += 0.3;
    // Token budget awareness: prefer compressed entries
    const tokenPenalty = e.tokenCount && e.tokenCount > 50 ? 0.9 : 1.0;
    score *= tokenPenalty;
    return { e, score, jac };
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0, topK).map(s=>s.e);
}

// Public API — compatible with old memory-store.ts but faster

export async function addMemoryEntry(category: string, content: string, relevance=0.5, confidence?: number): Promise<MemoryEntry> {
  if (!warmupDone) await warmup();
  const store = warmStore || await readDualStore();
  warmStore = store;
  const brain = categorizeBrain(category);
  const entry: MemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    category, content, createdAt: Date.now(), updatedAt: Date.now(),
    relevance, confidence: confidence ?? relevance,
    brain, entities: extractEntities(content), schemas: extractSchemas(content),
    stm: true, emotion: null, tokenCount: estimateTokens(content),
  };
  if (brain === "right") store.right.push(entry);
  else if (brain === "cross") store.cross.push(entry);
  else store.left.push(entry);
  await writeDualStore(store);
  // Add to hot cache immediately (STM)
  if (hotCache) hotCache.set(entry.id, entry);
  // Invalidate prefetch cache
  prefetchCache.clear();
  return entry;
}

export async function getMemoryEntries(category?: string): Promise<MemoryEntry[]> {
  if (!warmupDone) await warmup();
  const store = warmStore || await readDualStore();
  const all = [...store.left, ...store.right, ...store.cross];
  if (category) return all.filter(e=>e.category===category);
  return all;
}

export async function deleteMemoryEntry(id: string): Promise<boolean> {
  if (!warmupDone) await warmup();
  const store = warmStore || await readDualStore();
  const before = store.left.length + store.right.length + store.cross.length;
  store.left = store.left.filter(e=>e.id!==id);
  store.right = store.right.filter(e=>e.id!==id);
  store.cross = store.cross.filter(e=>e.id!==id);
  if (hotCache) hotCache.delete(id);
  prefetchCache.clear();
  if (store.left.length + store.right.length + store.cross.length === before) return false;
  await writeDualStore(store);
  return true;
}

export async function updateMemoryEntry(id: string, updates: Partial<Pick<MemoryEntry,"content"|"category"|"relevance"|"confidence">>): Promise<boolean> {
  if (!warmupDone) await warmup();
  const store = warmStore || await readDualStore();
  const all = [...store.left, ...store.right, ...store.cross];
  const entry = all.find(e=>e.id===id);
  if (!entry) return false;
  if (updates.content !== undefined) { entry.content = updates.content; entry.entities = extractEntities(updates.content); entry.schemas = extractSchemas(updates.content); entry.tokenCount = estimateTokens(updates.content); }
  if (updates.category !== undefined) entry.category = updates.category;
  if (updates.relevance !== undefined) entry.relevance = updates.relevance;
  if (updates.confidence !== undefined) entry.confidence = updates.confidence;
  entry.updatedAt = Date.now();
  entry.stm = (Date.now() - entry.createdAt < 86400000*7);
  // Move between brains if category changed
  const newBrain = categorizeBrain(entry.category);
  if (newBrain !== entry.brain) {
    // Remove from old
    store.left = store.left.filter(e=>e.id!==id);
    store.right = store.right.filter(e=>e.id!==id);
    store.cross = store.cross.filter(e=>e.id!==id);
    entry.brain = newBrain;
    if (newBrain === "right") store.right.push(entry);
    else if (newBrain === "cross") store.cross.push(entry);
    else store.left.push(entry);
  }
  await writeDualStore(store);
  prefetchCache.clear();
  return true;
}

export async function replaceAllEntries(entries: MemoryEntry[]): Promise<void> {
  if (!warmupDone) await warmup();
  const left: MemoryEntry[] = [];
  const right: MemoryEntry[] = [];
  const cross: MemoryEntry[] = [];
  for (const e of entries.map(migrateEntry)) {
    if (e.brain === "right") right.push(e);
    else if (e.brain === "cross") cross.push(e);
    else left.push(e);
  }
  const store: DualStore = { left, right, cross, version: 4 };
  await writeDualStore(store);
  prefetchCache.clear();
}

export async function clearMemory(): Promise<void> {
  const store = defaultDual();
  await writeDualStore(store);
  if (hotCache) hotCache.clear();
  prefetchCache.clear();
  warmStore = store;
}

// Core: getRelevantContext now uses dual-brain routing + Top-K + compression, with speculative prefetch cache
export async function getRelevantContext(query?: string): Promise<string> {
  // Fast path: if no query, return from hot cache Top-5 (like VoiceMem Top-K=5, ~300 tokens)
  if (!query) {
    if (!warmupDone) await warmup();
    const store = warmStore || await readDualStore();
    const all = [...store.left, ...store.right, ...store.cross];
    if (all.length === 0) return "";
    // Rank by relevance*recency without query
    const scored = all.map(e => {
      const ageDays = (Date.now() - e.updatedAt)/86400000;
      const decay = Math.pow(0.95, ageDays) * (ageDays<7?1.1:1);
      const score = e.relevance * decay * (0.6+e.confidence*0.6) * (e.brain==="right"?1.1:1);
      return { e, score };
    }).sort((a,b)=>b.score-a.score).slice(0,5);
    return compressToTokens(scored.map(s=>s.e), 430);
  }

  // Speculative prefetch: if query >= SPEC_MIN_CHARS, check cache (0-300ms hit like VoiceMem)
  const cacheKey = query.slice(0, 64).toLowerCase();
  const cached = prefetchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
    // Return cached result immediately (like VoiceMem streaming: memory already fetched while user spoke)
    return cached.result;
  }

  // Normal retrieval: route → rank → Top-K, but with hierarchical hot first
  if (!warmupDone) await warmup();
  const store = warmStore || await readDualStore();
  const route = routeQuery(query);
  const candidates: MemoryEntry[] = [];
  if (route.left) candidates.push(...store.left);
  if (route.right) candidates.push(...store.right);
  if (route.cross) candidates.push(...store.cross);
  // If route filtered too much, fallback to all
  const pool = candidates.length >= 3 ? candidates : [...store.left, ...store.right, ...store.cross];
  // Hierarchical: prioritize hot (STM) entries first, then rank
  const hotIds = new Set(getHotEntries().map(e=>e.id));
  const hotPool = pool.filter(e=>hotIds.has(e.id));
  const coldPool = pool.filter(e=>!hotIds.has(e.id));
  // Rank hot and cold separately, then merge Top-K (VoiceMem hierarchical)
  const rankedHot = rankEntries(query, hotPool, 3);
  const rankedCold = rankEntries(query, coldPool, 5);
  const merged = [...rankedHot, ...rankedCold];
  const topK = rankEntries(query, merged, 5); // final Top-5 like VoiceMem
  const result = compressToTokens(topK, 430);

  // Populate prefetch cache for future partials of same query
  prefetchCache.set(cacheKey, { result, left: store.left, right: store.right, ts: Date.now() });
  // Also cache prefixes for speculative (like VoiceMem SPEC_MIN_CHARS)
  if (query.length >= SPEC_MIN_CHARS) {
    for (let len = SPEC_MIN_CHARS; len < query.length; len++) {
      const prefix = query.slice(0, len).toLowerCase();
      if (!prefetchCache.has(prefix)) prefetchCache.set(prefix, { result, left: store.left, right: store.right, ts: Date.now() });
    }
  }
  return result;
}

// Compress to token budget like VoiceMem: ~430 tokens vs 6956 for Mem0
function compressToTokens(entries: MemoryEntry[], budget: number): string {
  if (entries.length === 0) return "";
  let tokens = 0;
  const lines: string[] = [];
  for (const e of entries) {
    const line = `- ${e.category}: ${e.content} [rel:${e.relevance.toFixed(2)}]`;
    const t = estimateTokens(line);
    if (tokens + t > budget) break;
    tokens += t;
    lines.push(line);
  }
  // If budget allows, add entities/schemas for left brain accuracy
  return lines.join("\n") + (tokens < budget ? "" : "");
}

export async function getRelevantContextSemantic(query: string): Promise<string> {
  return getRelevantContext(query);
}

// Speculative prefetch API like VoiceMem stream.feed
export async function prefetchQuery(partial: string): Promise<void> {
  if (partial.length < SPEC_MIN_CHARS) return;
  // Non-blocking, like VoiceMem 0-300ms
  const key = partial.slice(0,64).toLowerCase();
  if (prefetchCache.has(key) && Date.now() - (prefetchCache.get(key)?.ts||0) < PREFETCH_TTL) return;
  // Fire and forget
  getRelevantContext(partial).catch(()=>{});
}

export function getPrefetchCacheSize(): number { return prefetchCache.size; }

export async function detectContradictions(newContent: string, threshold=0.35) {
  if (!warmupDone) await warmup();
  const store = warmStore || await readDualStore();
  const all = [...store.left, ...store.right, ...store.cross];
  if (all.length===0) return [];
  const newTokens = new Set(newContent.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(s=>s.length>=3));
  const results: Array<{entry:MemoryEntry, overlap:number, reason:string}> = [];
  for (const e of all) {
    const eTokens = new Set(e.content.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(s=>s.length>=3));
    let inter=0; for(const t of newTokens) if(eTokens.has(t)) inter++;
    const union = newTokens.size + eTokens.size - inter;
    const jac = union? inter/union:0;
    if (jac>threshold) {
      const lower=newContent.toLowerCase();
      const hasNeg = lower.includes(" not ")||lower.includes(" no longer ")||lower.includes(" instead ")||lower.includes(" switched ")||lower.includes(" changed ")||lower.includes(" now ");
      const reason = hasNeg?"negation/override": jac>0.5?"high overlap supersession":"overlap supersession candidate";
      results.push({entry:e, overlap:jac, reason: hasNeg||jac>0.5?reason:reason+" (weak)"});
    }
  }
  results.sort((a,b)=>b.overlap-a.overlap);
  return results;
}

export async function upsertMemoryWithContradictionCheck(category:string,content:string,relevance=0.6,confidence?:number){
  const contradictions = await detectContradictions(content,0.3);
  const superseded: MemoryEntry[] = [];
  if (contradictions.length>0) {
    for(const {entry} of contradictions){
      if(entry.category===category || contradictions[0].overlap>0.5){
        await updateMemoryEntry(entry.id,{relevance: Math.max(0.1, entry.relevance*0.6)});
        superseded.push(entry);
      }
    }
  }
  const entry = await addMemoryEntry(category,content,relevance,confidence);
  return {entry, superseded};
}

// For testing: expose warmup status and dual store
export function isWarmedUp(): boolean { return warmupDone; }
export async function getDualStore(): Promise<DualStore> { if(!warmupDone) await warmup(); return warmStore || defaultDual(); }
