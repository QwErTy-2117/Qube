/**
 * Scratchpad — per-thread lightweight external memory.
 *
 * A markdown file the agent decides to use (not mandated) for multi-step work.
 * Cheaper than re-reading files or bloating context. Survives compaction
 * (summary can cite it) but is not auto-injected — the agent reads it JIT.
 *
 * Location: <dataDir>/.memory/scratchpads/<threadId>.md
 */

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

function dir(): string {
  return join(getDataDir(), ".memory", "scratchpads");
}
function pathFor(threadId: string): string {
  const safe = String(threadId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "unknown";
  return join(dir(), `${safe}.md`);
}

function ensureDir() {
  const d = dir();
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export async function readScratchpad(threadId: string): Promise<string | null> {
  try {
    return await readFile(pathFor(threadId), "utf-8");
  } catch {
    return null;
  }
}

export async function writeScratchpad(threadId: string, content: string): Promise<void> {
  ensureDir();
  await mkdir(dir(), { recursive: true });
  await writeFile(pathFor(threadId), content, "utf-8");
}

export async function appendScratchpad(threadId: string, chunk: string): Promise<void> {
  ensureDir();
  const prev = (await readScratchpad(threadId)) || "";
  await writeFile(pathFor(threadId), prev ? `${prev}\n${chunk}` : chunk, "utf-8");
}

export async function clearScratchpad(threadId: string): Promise<void> {
  await unlink(pathFor(threadId)).catch(() => {});
}

export function scratchpadPath(threadId: string): string {
  return pathFor(threadId);
}
