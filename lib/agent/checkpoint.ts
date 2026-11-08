/**
 * Durable checkpoints (formerly a no-op stub).
 *
 * Checkpoints are append-only, bounded snapshots of task state. They
 * complement the execution ledger: the ledger answers "is a run alive and
 * what did it just do", while checkpoints answer "what did the agent know at
 * a specific point". Both are separate from the transcript and from the
 * LLM-generated compaction summary.
 *
 * Storage: .memory/checkpoints/<thread>.jsonl (last 100 records).
 */

import { appendFile, mkdir, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { redactSecrets } from "@/lib/memory/safety";
import { isRunStale, loadRun } from "@/lib/agent/execution-ledger";

export type CheckpointState = {
  todos?: Array<{ content: string; status: string; activeForm?: string }>;
  filesTouched?: string[];
  evidence?: Array<{ kind: string; detail: string }>;
  notes?: string;
  [key: string]: unknown;
};

export type Checkpoint = {
  id: string;
  threadId: string;
  runId?: string;
  label: string;
  createdAt: number;
  state: CheckpointState;
  summary?: string;
};

export type ResumePlan = {
  shouldResume: boolean;
  reason: string;
  verificationNeeded: string[];
  staleChecks: string[];
  checkpoint?: Checkpoint;
  resumeNotice?: string;
};

const MAX_HISTORY = 100;

function checkpointsDir(): string {
  return join(getDataDir(), ".memory", "checkpoints");
}

function safeThread(threadId: string): string {
  return String(threadId || "global").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "global";
}

function checkpointPath(threadId: string): string {
  return join(checkpointsDir(), `${safeThread(threadId)}.jsonl`);
}

function boundedState(state: CheckpointState): CheckpointState {
  try {
    const serialized = JSON.stringify(state, (_k, v) => {
      if (typeof v === "string" && v.length > 4_000) return `${v.slice(0, 4_000)}…[truncated]`;
      return v;
    });
    return JSON.parse(redactSecrets(serialized)) as CheckpointState;
  } catch {
    return {};
  }
}

export async function saveCheckpoint(args: {
  threadId: string;
  label: string;
  state?: CheckpointState;
  runId?: string;
  summary?: string;
}): Promise<Checkpoint> {
  const cp: Checkpoint = {
    id: `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    threadId: args.threadId,
    runId: args.runId,
    label: String(args.label || "checkpoint").slice(0, 200),
    createdAt: Date.now(),
    state: boundedState(args.state || {}),
    summary: args.summary ? redactSecrets(args.summary).slice(0, 20_000) : undefined,
  };
  if (!existsSync(checkpointsDir())) await mkdir(checkpointsDir(), { recursive: true });
  await appendFile(checkpointPath(args.threadId), JSON.stringify(cp) + "\n", "utf-8");
  void pruneCheckpoints(args.threadId).catch(() => {});
  return cp;
}

async function readHistory(threadId: string): Promise<Checkpoint[]> {
  try {
    const raw = await readFile(checkpointPath(threadId), "utf-8");
    const out: Checkpoint[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as Checkpoint;
        if (rec && typeof rec.id === "string" && typeof rec.threadId === "string") out.push(rec);
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadCheckpoint(threadId: string): Promise<Checkpoint | null> {
  const history = await readHistory(threadId);
  return history.length > 0 ? history[history.length - 1] : null;
}

export async function loadCheckpointHistory(threadId: string): Promise<Checkpoint[]> {
  return readHistory(threadId);
}

/**
 * Decide whether a thread has interrupted work worth resuming. The ledger is
 * the primary signal; the newest checkpoint supplies the last known task
 * state and the verification checklist.
 */
export async function buildResumePlan(threadId: string): Promise<ResumePlan> {
  const [ledger, checkpoint] = await Promise.all([
    loadRun(threadId).catch(() => null),
    loadCheckpoint(threadId),
  ]);
  if (!ledger) {
    return { shouldResume: false, reason: "no execution record", verificationNeeded: [], staleChecks: [], checkpoint: checkpoint || undefined };
  }
  const stale = isRunStale(ledger);
  const interrupted = ledger.status === "interrupted" || stale;
  const running = ledger.status === "running" && !stale;
  if (!interrupted && !running) {
    return {
      shouldResume: false,
      reason: `last run ${ledger.status}`,
      verificationNeeded: [],
      staleChecks: [],
      checkpoint: checkpoint || undefined,
    };
  }
  const verificationNeeded: string[] = [];
  for (const f of (ledger.filesTouched || []).slice(-10)) verificationNeeded.push(`file still exists and contains intended changes: ${f}`);
  for (const t of (ledger.todos || []).filter((x) => x.status !== "completed").slice(0, 10)) {
    verificationNeeded.push(`todo still open: ${String(t.content || "").slice(0, 160)}`);
  }
  const pending = (ledger.journal || []).filter((j) => j.state === "pending");
  const staleChecks: string[] = pending.map(
    (j) => `unknown outcome: ${j.tool}${j.argsPreview ? ` ${j.argsPreview.slice(0, 120)}` : ""}`,
  );
  return {
    shouldResume: true,
    reason: interrupted
      ? `previous run ${ledger.runId} was interrupted`
      : `previous run ${ledger.runId} may still be alive or died without a clean shutdown`,
    verificationNeeded,
    staleChecks,
    checkpoint: checkpoint || undefined,
    resumeNotice: checkpoint ? formatCheckpointForPrompt(checkpoint) : undefined,
  };
}

export function formatCheckpointForPrompt(cp: Checkpoint): string {
  if (!cp) return "";
  const state = cp.state || {};
  const lines = [`checkpoint ${cp.id} (${cp.label}) at ${new Date(cp.createdAt).toISOString()}`];
  const todos = Array.isArray(state.todos) ? state.todos.slice(0, 20) : [];
  if (todos.length > 0) {
    lines.push("todos:");
    for (const t of todos) lines.push(`- [${t.status}] ${String(t.content || "").slice(0, 180)}`);
  }
  const files = Array.isArray(state.filesTouched) ? state.filesTouched.slice(-10) : [];
  if (files.length > 0) lines.push(`files: ${files.join(", ")}`);
  if (state.notes) lines.push(`notes: ${String(state.notes).slice(0, 800)}`);
  if (cp.summary) lines.push(`summary: ${cp.summary.slice(0, 2_000)}`);
  return lines.join("\n").slice(0, 4_000);
}

export async function clearCheckpoint(threadId: string): Promise<void> {
  await unlink(checkpointPath(threadId)).catch(() => {});
}

async function pruneCheckpoints(threadId: string): Promise<void> {
  const history = await readHistory(threadId);
  if (history.length <= MAX_HISTORY) return;
  const kept = history.slice(-MAX_HISTORY);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(checkpointPath(threadId), kept.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf-8");
}

/**
 * Compact the visible history and persist the resulting state as a
 * checkpoint. Returns the compaction result unchanged.
 */
export async function compactAndCheckpoint(args: {
  threadId: string;
  messages: Array<Record<string, unknown>>;
  systemPrompt: string;
  modelName?: string;
  request?: Request;
  force?: boolean;
  aggressive?: boolean;
  tools?: Record<string, unknown>;
  state?: CheckpointState;
}): Promise<{ compactedMessages: Array<Record<string, unknown>>; summaryBlock: string; freshSummary: boolean }> {
  const { maybeCompactMessages } = await import("@/lib/pi/compaction");
  const result = await maybeCompactMessages({
    messages: args.messages,
    threadId: args.threadId,
    systemPrompt: args.systemPrompt,
    modelName: args.modelName,
    request: args.request,
    force: args.force,
    aggressive: args.aggressive,
    tools: args.tools,
  });
  const ledger = await loadRun(args.threadId).catch(() => null);
  await saveCheckpoint({
    threadId: args.threadId,
    runId: ledger?.runId,
    label: result.freshSummary ? "post-compaction summary" : "context checkpoint",
    state: {
      ...args.state,
      todos: args.state?.todos || ledger?.todos,
      filesTouched: args.state?.filesTouched || ledger?.filesTouched,
    },
    summary: result.summary,
  }).catch(() => {});
  return { compactedMessages: result.messages, summaryBlock: result.summaryBlock, freshSummary: result.freshSummary };
}
