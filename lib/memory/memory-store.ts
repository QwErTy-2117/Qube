import { readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MEMORY_FILE = join(process.cwd(), ".memory", "semantic-memory.json");

type MemoryEntry = {
  id: string;
  category: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  confidence: number;
};

type MemoryStore = {
  entries: MemoryEntry[];
  version: number;
};

function defaultStore(): MemoryStore {
  return { entries: [], version: 1 };
}

function ensureDir() {
  const dir = join(process.cwd(), ".memory");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function readStore(): Promise<MemoryStore> {
  try {
    const data = await readFile(MEMORY_FILE, "utf-8");
    return JSON.parse(data);
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
  confidence = 1.0,
): Promise<void> {
  const store = await readStore();
  store.entries.push({
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    confidence,
  });
  await writeStore(store);
}

export async function updateMemoryEntry(
  id: string,
  updates: Partial<Pick<MemoryEntry, "content" | "category" | "confidence">>,
): Promise<boolean> {
  const store = await readStore();
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return false;
  if (updates.content !== undefined) entry.content = updates.content;
  if (updates.category !== undefined) entry.category = updates.category;
  if (updates.confidence !== undefined) entry.confidence = updates.confidence;
  entry.updatedAt = Date.now();
  await writeStore(store);
  return true;
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

export async function getRelevantContext(): Promise<string> {
  const store = await readStore();
  if (store.entries.length === 0) return "";
  const highConfidence = store.entries
    .filter((e) => e.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence);
  if (highConfidence.length === 0) return "";
  const lines = highConfidence.map((e) => `- ${e.category}: ${e.content}`);
  return lines.join("\n");
}

export async function clearMemory(): Promise<void> {
  await writeStore(defaultStore());
}
