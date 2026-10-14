/**
 * Observability — file-based JSONL telemetry for memory/skill/proactivity.
 *
 * Writes to .memory/observability/<thread>.jsonl + _global.jsonl so developers
 * can answer: which memories retrieved/why, written/why, skills created/updated
 * /selected, proactive opportunity/evidence/decision, confirmation needs,
 * suppression reasons. Sensitive content is redacted before logging.
 *
 * Backward compatible with the previous stub (same exports).
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { redactSecrets } from "@/lib/memory/safety";

function dir(): string {
  return join(getDataDir(), ".memory", "observability");
}

async function ensureDir() {
  if (!existsSync(dir())) await mkdir(dir(), { recursive: true });
}

function safeMeta(meta: any): any {
  try {
    const s = JSON.stringify(meta ?? {}, (_k, v) => (typeof v === "string" && v.length > 2000 ? v.slice(0, 2000) + "…[truncated]" : v));
    const redacted = redactSecrets(s);
    return JSON.parse(redacted);
  } catch {
    return {};
  }
}

export type ObsEvent = {
  threadId: string;
  type: string;
  taskId?: string;
  status?: string;
  reason?: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
  at?: number;
};

export async function logEvent(event: ObsEvent & { threadId: string; type: string }): Promise<void> {
  try {
    await ensureDir();
    const record = {
      at: Date.now(),
      ...event,
      metadata: safeMeta((event as any).metadata),
      reason: typeof (event as any).reason === "string" ? redactSecrets(String((event as any).reason)).slice(0, 1000) : (event as any).reason,
    };
    const line = JSON.stringify(record) + "\n";
    const safeThread = String(event.threadId || "global").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "global";
    await appendFile(join(dir(), `${safeThread}.jsonl`), line, "utf-8").catch(() => {});
    await appendFile(join(dir(), `_global.jsonl`), line, "utf-8").catch(() => {});
  } catch {}
}

export async function logToolCall(threadId: string, tool: string, args?: any): Promise<void> {
  await logEvent({ threadId, type: "tool_call", metadata: { tool, args: safeMeta(args) } });
}

export async function logToolResult(threadId: string, tool: string, ok: boolean, summary?: string): Promise<void> {
  await logEvent({ threadId, type: "tool_result", status: ok ? "success" : "error", metadata: { tool, summary: summary?.slice(0, 500) } });
}

export async function logToolRetry(threadId: string, tool: string, attempt: number, reason?: string): Promise<void> {
  await logEvent({ threadId, type: "tool_retry", metadata: { tool, attempt }, reason });
}

export async function logCheckpoint(threadId: string, label: string, metadata?: any): Promise<void> {
  await logEvent({ threadId, type: "checkpoint", metadata: { label, ...safeMeta(metadata) } });
}

export async function logRecovery(threadId: string, strategy: string, metadata?: any): Promise<void> {
  await logEvent({ threadId, type: "recovery", metadata: { strategy, ...safeMeta(metadata) } });
}

export async function logStopReason(threadId: string, reason: string): Promise<void> {
  await logEvent({ threadId, type: "stop", reason });
}

// --- Domain helpers (§27) ---

export async function logMemoryRetrieved(threadId: string, query: string, ids: string[], reasons: string[]): Promise<void> {
  await logEvent({ threadId, type: "memory_retrieved", metadata: { query: query.slice(0, 300), ids, reasons: reasons.slice(0, 8) } });
}

export async function logMemoryWritten(threadId: string, id: string, category: string, reason: string): Promise<void> {
  await logEvent({ threadId, type: "memory_written", metadata: { id, category, reason } });
}

export async function logMemorySuppressed(threadId: string, reason: string, query?: string): Promise<void> {
  await logEvent({ threadId, type: "memory_suppressed", reason, metadata: { query: query?.slice(0, 300) } });
}

export async function logSkillEvent(threadId: string, action: "created" | "updated" | "selected" | "deprecated" | "failed", name: string, reason: string): Promise<void> {
  await logEvent({ threadId, type: `skill_${action}`, metadata: { skill: name, reason } });
}

export async function logProactiveEvent(
  threadId: string,
  action: "detected" | "suggested" | "scheduled" | "executed" | "suppressed" | "deferred" | "rejected_learned",
  topic: string,
  detail: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logEvent({ threadId, type: `proactive_${action}`, metadata: { topic: topic.slice(0, 200), detail: detail.slice(0, 1000), ...safeMeta(metadata) } });
}

export function getExecutionId(): string {
  return `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function matchesType(e: any, type?: string | string[]): boolean {
  if (!type) return true;
  const want = Array.isArray(type) ? type : [type];
  return want.includes(String(e?.type || ""));
}

/**
 * Read back what was logged: per-thread action history for "what did the
 * agent do" (computer_action entries carry tool/risk/verdict/signals).
 * Previously stubs — now backed by the same JSONL files logEvent writes.
 */
export async function queryObservability(
  threadId: string,
  opts?: { type?: string | string[]; limit?: number },
): Promise<any[]> {
  const limit = Math.min(Math.max(Number(opts?.limit) || 50, 1), 500);
  // Read a wider window than the limit so type filters still return results.
  const events = await readRecentEvents(threadId, Math.max(limit, 200));
  return events.filter((e) => matchesType(e, opts?.type)).slice(-limit);
}

export async function getGlobalRecent(limit = 50): Promise<any[]> {
  try {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const raw = await readFile(join(dir(), `_global.jsonl`), "utf-8");
    return raw.trim().split("\n").slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

export async function getStats(threadId?: string): Promise<{ total: number; byType: Record<string, number>; errors: number }> {
  try {
    const events = threadId ? await readRecentEvents(threadId, 500) : await getGlobalRecent(500);
    const byType: Record<string, number> = {};
    let errors = 0;
    for (const e of events) {
      const t = String((e as any)?.type || "unknown");
      byType[t] = (byType[t] || 0) + 1;
      if ((e as any)?.status === "error") errors++;
    }
    return { total: events.length, byType, errors };
  } catch {
    return { total: 0, byType: {}, errors: 0 };
  }
}

export async function readRecentEvents(threadId: string, limit = 50): Promise<any[]> {
  try {
    const safeThread = String(threadId || "global").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const raw = await readFile(join(dir(), `${safeThread}.jsonl`), "utf-8");
    return raw.trim().split("\n").slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}
