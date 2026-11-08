/**
 * Bounded tool output + spill files.
 *
 * Models only need the relevant head/tail of a large tool result; the full
 * output still matters for later inspection. Instead of silently slicing
 * (and losing the rest), oversized results are written to a per-thread spill
 * file and the model receives a short, actionable truncation notice with an
 * id it can page through using read_tool_output.
 *
 * All operations are confined to getDataDir()/.memory/tool-outputs. Ids are
 * validated before path construction, so a model-supplied id can never
 * escape the directory.
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getDataDir } from "@/lib/data-dir";
import { redactSecrets } from "@/lib/memory/safety";

export type ToolOutputLimits = {
  /** Inline output cap after which the full text is spilled. */
  inlineChars: number;
  /** Hard cap for a single inline result (even without spill). */
  maxChars: number;
  /** Max chars returned by one read_tool_output call. */
  readChars: number;
  /** Spill retention. */
  retentionMs: number;
  /** Max spill files kept per thread. */
  maxFiles: number;
};

export function getToolOutputLimits(): ToolOutputLimits {
  const num = (v: string | undefined, dflt: number, min: number, max: number) => {
    const n = parseInt(v || "", 10);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
  };
  return {
    inlineChars: num(process.env.QUBE_TOOL_OUTPUT_INLINE_CHARS, 16_000, 1_000, 500_000),
    maxChars: num(process.env.QUBE_TOOL_OUTPUT_MAX_CHARS, 24_000, 1_000, 500_000),
    readChars: num(process.env.QUBE_TOOL_OUTPUT_READ_CHARS, 30_000, 1_000, 100_000),
    retentionMs: num(process.env.QUBE_TOOL_OUTPUT_RETENTION_HOURS, 168, 1, 24 * 365) * 60 * 60 * 1000,
    maxFiles: num(process.env.QUBE_TOOL_OUTPUT_MAX_FILES, 200, 10, 5_000),
  };
}

const ID_RE = /^[a-zA-Z0-9_-]{6,80}$/;
const TOOL_NAME_RE = /[^a-zA-Z0-9_-]/g;

function safeThread(threadId: string): string {
  return String(threadId || "global").replace(TOOL_NAME_RE, "_").slice(0, 100) || "global";
}

export function toolOutputDir(threadId: string): string {
  return join(getDataDir(), ".memory", "tool-outputs", safeThread(threadId));
}

function spillPath(threadId: string, id: string): string {
  return join(toolOutputDir(threadId), `${id}.txt`);
}

export function isValidToolOutputId(id: string): boolean {
  return ID_RE.test(String(id || ""));
}

function newId(toolName: string): string {
  const tool = String(toolName || "tool").replace(TOOL_NAME_RE, "_").slice(0, 24);
  return `${Date.now().toString(36)}_${tool}_${randomBytes(4).toString("hex")}`;
}

/** Persist the full text, returning its id. Secrets are redacted first. */
export async function spillToolOutput(threadId: string, toolName: string, text: string): Promise<{ id: string; path: string; chars: number }> {
  if (!existsSync(toolOutputDir(threadId))) await mkdir(toolOutputDir(threadId), { recursive: true });
  const safeText = redactSecrets(String(text ?? ""));
  const id = newId(toolName);
  const path = spillPath(threadId, id);
  await writeFile(path, safeText, "utf-8");
  void pruneToolOutputs(threadId).catch(() => {});
  return { id, path, chars: safeText.length };
}

export function formatSpillNotice(id: string, shownChars: number, totalChars: number): string {
  return (
    `\n\n[tool output truncated: showing ${shownChars} of ${totalChars} chars. ` +
    `Full output id="${id}". Call read_tool_output({ id: "${id}", offset: ${shownChars} }) ` +
    `to continue reading; do not re-run the command just to see more.]`
  );
}

export type BoundedOutput = {
  text: string;
  spilled?: { id: string; chars: number };
  originalChars: number;
  shownChars: number;
};

/**
 * Bound a tool result. Small results are returned unchanged. Large results
 * are spilled and cut to `inlineChars`, with the spill notice appended.
 */
export async function boundToolOutput(
  threadId: string,
  toolName: string,
  text: string,
  opts?: { strategy?: "head" | "tail"; inlineChars?: number },
): Promise<BoundedOutput> {
  const limits = getToolOutputLimits();
  const raw = String(text ?? "");
  if (raw.length <= (opts?.inlineChars ?? limits.inlineChars)) {
    return { text: raw, originalChars: raw.length, shownChars: raw.length };
  }
  const spill = await spillToolOutput(threadId, toolName, raw);
  const keep = Math.min(opts?.inlineChars ?? limits.inlineChars, limits.maxChars);
  const shown = opts?.strategy === "tail" ? raw.slice(-keep) : raw.slice(0, keep);
  const body = opts?.strategy === "tail" ? `[head omitted]\n${shown}` : shown;
  const notice = formatSpillNotice(spill.id, body.length, raw.length);
  const textOut = `${body}${notice}`;
  return {
    text: textOut.slice(0, limits.maxChars + notice.length),
    spilled: { id: spill.id, chars: spill.chars },
    originalChars: raw.length,
    shownChars: body.length,
  };
}

export type ReadSpillResult = {
  id: string;
  content: string;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
  eof: boolean;
};

/** Read a slice of a spilled output. Path traversal is impossible by design. */
export async function readToolOutput(
  threadId: string,
  id: string,
  opts?: { offset?: number; maxChars?: number },
): Promise<ReadSpillResult> {
  if (!isValidToolOutputId(id)) throw new Error(`Invalid tool output id: ${id}`);
  const limits = getToolOutputLimits();
  const maxChars = Math.min(Math.max(Number(opts?.maxChars) || limits.readChars, 200), limits.readChars);
  const offset = Math.max(0, Math.floor(Number(opts?.offset) || 0));
  const raw = await readFile(spillPath(threadId, id), "utf-8");
  if (offset >= raw.length) {
    return { id, content: "", offset, nextOffset: null, totalChars: raw.length, eof: true };
  }
  const end = Math.min(raw.length, offset + maxChars);
  return {
    id,
    content: raw.slice(offset, end),
    offset,
    nextOffset: end < raw.length ? end : null,
    totalChars: raw.length,
    eof: end >= raw.length,
  };
}

/**
 * Delete expired spill files and cap the per-thread count (oldest first).
 * Fire-and-forget; never blocks a tool result.
 */
export async function pruneToolOutputs(threadId: string): Promise<number> {
  const limits = getToolOutputLimits();
  const dir = toolOutputDir(threadId);
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith(".txt"));
  } catch {
    return 0;
  }
  const now = Date.now();
  const files: Array<{ name: string; mtime: number }> = [];
  for (const name of entries) {
    try {
      const s = await stat(join(dir, name));
      if (now - s.mtimeMs > limits.retentionMs) {
        await unlink(join(dir, name)).catch(() => {});
      } else {
        files.push({ name, mtime: s.mtimeMs });
      }
    } catch {}
  }
  files.sort((a, b) => b.mtime - a.mtime);
  let removed = 0;
  for (const f of files.slice(limits.maxFiles)) {
    await unlink(join(dir, f.name)).catch(() => {});
    removed++;
  }
  return removed;
}

export async function pruneAllToolOutputs(): Promise<number> {
  let total = 0;
  try {
    const root = join(getDataDir(), ".memory", "tool-outputs");
    const dirs = await readdir(root);
    for (const d of dirs) total += await pruneToolOutputs(d);
  } catch {}
  return total;
}
