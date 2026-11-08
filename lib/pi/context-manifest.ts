/**
 * Post-compaction manifest.
 *
 * A summary is lossy; TodoWrite/scratchpad/files are not. After any
 * compaction the harness injects this small, bounded block built from real
 * execution state (ledger + disk), so the model cannot "forget" that a file
 * exists or that a todo is still open because the summary omitted it.
 *
 * This is authoritative machine-generated state. It is framed separately
 * from the untrusted conversation summary and never derived from model text.
 */

import { stat } from "node:fs/promises";
import { loadRun } from "@/lib/agent/execution-ledger";

export const MAX_MANIFEST_CHARS = 6_000;

export async function buildContextManifest(opts: {
  threadId: string;
  maxChars?: number;
}): Promise<string> {
  const maxChars = Math.min(Math.max(opts.maxChars ?? MAX_MANIFEST_CHARS, 500), 20_000);
  const ledger = await loadRun(opts.threadId).catch(() => null);
  if (!ledger) return "";

  const lines: string[] = [];
  const todos = (ledger.todos || []).slice(0, 30);
  if (todos.length > 0) {
    const done = todos.filter((t) => t.status === "completed").length;
    lines.push(`Todo list (${done}/${todos.length} completed):`);
    for (const t of todos) {
      lines.push(`- [${t.status}] ${String(t.content || "").slice(0, 220)}`);
    }
  }

  const files = (ledger.filesTouched || []).slice(-12);
  if (files.length > 0) {
    lines.push("Files touched (checked on disk now):");
    for (const path of files) {
      try {
        const s = await stat(path);
        lines.push(`- ${path} — exists (${s.size} bytes)`);
      } catch {
        lines.push(`- ${path} — MISSING (verify before claiming completion)`);
      }
    }
  }

  const evidence = (ledger.evidence || []).slice(-8);
  if (evidence.length > 0) {
    lines.push("Recent verified evidence:");
    for (const e of evidence) lines.push(`- ${e.kind}: ${String(e.detail || "").slice(0, 300)}`);
  }

  if (ledger.lastError) lines.push(`Last recorded tool error: ${String(ledger.lastError).slice(0, 400)}`);
  if (lines.length === 0) return "";

  const header =
    `## Authoritative task state (post-compaction)\n` +
    `Machine-generated from the execution ledger and the filesystem. This overrides the conversation summary ` +
    `where they disagree. Re-verify with tools before acting on it.\n`;
  return `${header}${lines.join("\n")}`.slice(0, maxChars);
}
