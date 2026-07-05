import { readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MEMORY_FILE = join(process.cwd(), ".memory", "semantic-memory.json");

export type MemoryEntry = {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  relevance: number;
};

type MemoryStore = {
  entries: MemoryEntry[];
  version: number;
};

function defaultStore(): MemoryStore {
  return { entries: [], version: 2 };
}

function ensureDir() {
  const dir = join(process.cwd(), ".memory");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function migrateEntry(e: Record<string, unknown>): MemoryEntry {
  return {
    id: String(e.id ?? `mem_${Date.now()}`),
    category: String(e.category ?? "general"),
    content: String(e.content ?? ""),
    createdAt: Number(e.createdAt ?? Date.now()),
    updatedAt: Number(e.updatedAt ?? Date.now()),
    relevance: e.relevance !== undefined ? Number(e.relevance) : e.confidence !== undefined ? Number(e.confidence) : 0.5,
  };
}

async function readStore(): Promise<MemoryStore> {
  try {
    const data = await readFile(MEMORY_FILE, "utf-8");
    const raw = JSON.parse(data);
    const entries = (raw.entries ?? []).map(migrateEntry);
    return { entries, version: 2 };
  } catch {
    return defaultStore();
  }
}

async function writeStore(store: MemoryStore): Promise<void> {
  ensureDir();
  await writeFile(MEMORY_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export async function addMemoryEntry(
  category: string,
  content: string,
  relevance = 0.5,
): Promise<MemoryEntry> {
  const store = await readStore();
  const entry: MemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    relevance,
  };
  store.entries.push(entry);
  await writeStore(store);
  return entry;
}

export async function updateMemoryEntry(
  id: string,
  updates: Partial<Pick<MemoryEntry, "content" | "category" | "relevance">>,
): Promise<boolean> {
  const store = await readStore();
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return false;
  if (updates.content !== undefined) entry.content = updates.content;
  if (updates.category !== undefined) entry.category = updates.category;
  if (updates.relevance !== undefined) entry.relevance = updates.relevance;
  entry.updatedAt = Date.now();
  await writeStore(store);
  return true;
}

export async function replaceAllEntries(entries: MemoryEntry[]): Promise<void> {
  await writeStore({ entries, version: 2 });
}

export async function getMemoryEntries(
  category?: string,
): Promise<MemoryEntry[]> {
  const store = await readStore();
  if (category) {
    return store.entries.filter((e) => e.category === category);
  }
  return store.entries;
}

export async function deleteMemoryEntry(id: string): Promise<boolean> {
  const store = await readStore();
  const initialLength = store.entries.length;
  store.entries = store.entries.filter((e) => e.id !== id);
  if (store.entries.length === initialLength) return false;
  await writeStore(store);
  return true;
}

export async function getRelevantContext(): Promise<string> {
  const store = await readStore();
  if (store.entries.length === 0) return "";
  const relevant = store.entries
    .filter((e) => e.relevance >= 0.4)
    .sort((a, b) => b.relevance - a.relevance);
  if (relevant.length === 0) return "";
  const lines = relevant.map((e) => `- ${e.category}: ${e.content}`);
  return lines.join("\n");
}

export async function clearMemory(): Promise<void> {
  await writeStore(defaultStore());
}
