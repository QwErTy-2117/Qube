/**
 * Durable execution ledger for the Pi harness.
 *
 * The production harness kept run state only in memory (`activeRuns`). A
 * server restart, crash, or steer therefore lost "what was I doing" even
 * though the transcript survived. This ledger persists a small, bounded
 * execution record per thread:
 *
 *  - run lifecycle (running / completed / failed / cancelled / interrupted)
 *  - heartbeat + iteration/tool counters
 *  - the last TodoWrite snapshot
 *  - files touched and verification evidence
 *  - a write-ahead tool journal for mutating actions
 *
 * Write-ahead matters: a file mutation is journaled as `pending` before it
 * executes and marked `ok` after. If the process dies mid-call, the next run
 * sees an unknown outcome and the resume notice says "verify before
 * retrying" instead of blindly repeating an external side effect.
 *
 * Writes are serialized per thread (parallel tool calls are common) and
 * written atomically via temp file + rename. The ledger is advisory state:
 * it never replaces the transcript, todos, scratchpad, or files on disk.
 */

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getDataDir } from "@/lib/data-dir";

export type LedgerStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type JournalState = "pending" | "ok" | "error";

export type LedgerJournalEntry = {
  key: string;
  tool: string;
  state: JournalState;
  at: number;
  mutating: boolean;
  /** Bounded result preview for replayable file tools. */
  result?: string;
  argsPreview?: string;
};

export type LedgerTodo = { content: string; status: string; activeForm?: string };

export type LedgerEvidence = { kind: string; detail: string; at: number };

export type RunLedger = {
  version: 1;
  runId: string;
  threadId: string;
  modelName?: string;
  status: LedgerStatus;
  startedAt: number;
  updatedAt: number;
  heartbeatAt: number;
  finishedAt?: number;
  iterations: number;
  toolCalls: number;
  toolFailures: number;
  lastTool?: { name: string; state: JournalState; at: number };
  lastError?: string;
  todos?: LedgerTodo[];
  filesTouched: string[];
  evidence: LedgerEvidence[];
  journal: LedgerJournalEntry[];
  resumeOf?: string;
  resumeNoticeDeliveredAt?: number;
};

export type ResumeInfo = {
  runId: string;
  threadId: string;
  interruptedAt: number;
  iterations: number;
  todos: LedgerTodo[];
  filesTouched: string[];
  pendingTools: LedgerJournalEntry[];
  lastError?: string;
  notice: string;
};

const FILE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);
const EXTERNAL_MUTATING_RE =
  /send|create|delete|update|post|reply|publish|upload|share|purchase|pay|book|merge|close|archive|move|rename|invite|remove|set_/i;
const MAX_ENTRIES = 40;
const JOURNAL_TTL_MS = 10 * 60 * 1000;

export function isMutatingToolName(name: string): boolean {
  return FILE_TOOLS.has(name) || EXTERNAL_MUTATING_RE.test(name);
}

export function isReplayableToolName(name: string): boolean {
  return FILE_TOOLS.has(name);
}

function runsDir(): string {
  return join(getDataDir(), ".memory", "runs");
}

function safeThread(threadId: string): string {
  return String(threadId || "global").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "global";
}

function ledgerPath(threadId: string): string {
  return join(runsDir(), `${safeThread(threadId)}.json`);
}

function ensureRunsDir() {
  if (!existsSync(runsDir())) mkdirSync(runsDir(), { recursive: true });
}

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Stable JSON (sorted object keys) so the same call hashes identically. */
function stableStringify(value: unknown, depth = 0): string {
  if (depth > 6) return '"[depth]"';
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v, depth + 1)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k], depth + 1)}`).join(",")}}`;
}

export function toolJournalKey(toolName: string, args: unknown): string {
  let serialized = "";
  try {
    serialized = stableStringify(args).slice(0, 2_000_000);
  } catch {
    serialized = String(args);
  }
  return createHash("sha1").update(`${toolName}\n${serialized}`).digest("hex").slice(0, 24);
}

// ---------- Per-thread write serialization ----------

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(threadId) || Promise.resolve();
  const next = prev.then(fn, fn);
  const tracked = next.catch(() => {}).finally(() => {
    if (queues.get(threadId) === tracked) queues.delete(threadId);
  });
  queues.set(threadId, tracked);
  return next;
}

async function loadLedger(threadId: string): Promise<RunLedger | null> {
  try {
    const raw = await readFile(ledgerPath(threadId), "utf-8");
    const rec = JSON.parse(raw) as RunLedger;
    if (!rec || rec.version !== 1 || typeof rec.runId !== "string") return null;
    return rec;
  } catch {
    return null;
  }
}

async function saveLedger(rec: RunLedger): Promise<void> {
  ensureRunsDir();
  const path = ledgerPath(rec.threadId);
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  await writeFile(tmp, JSON.stringify(rec, null, 2), "utf-8");
  await rename(tmp, path);
}

export async function loadRun(threadId: string): Promise<RunLedger | null> {
  return loadLedger(threadId);
}

function pruneJournal(journal: LedgerJournalEntry[]): LedgerJournalEntry[] {
  const now = Date.now();
  return journal
    .filter((e) => e && now - e.at < JOURNAL_TTL_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ENTRIES);
}

function staleMs(): number {
  const n = parseInt(process.env.QUBE_RUN_STALE_MS || "45000", 10);
  return Number.isFinite(n) && n > 500 ? n : 45_000;
}

/**
 * A `running` record whose heartbeat stopped is presumed dead. Readers use
 * this instead of trusting the stored status, which can only be corrected by
 * a writer that notices the run is gone.
 */
export function isRunStale(rec: Pick<RunLedger, "status" | "heartbeatAt">, now = Date.now()): boolean {
  if (rec.status !== "running") return false;
  return now - Number(rec.heartbeatAt || 0) > staleMs();
}

function makeResumeInfo(prev: RunLedger): ResumeInfo {
  const pending = (prev.journal || []).filter((e) => e.state === "pending");
  const todos = (prev.todos || []).filter((t) => t.status !== "completed").slice(0, 20);
  const lines = [
    `[Resumed run — previous execution ${prev.status} at ${new Date(prev.updatedAt).toISOString()}]`,
    `Run ${prev.runId} made ${prev.iterations} iteration(s) and ${prev.toolCalls} tool call(s) before it stopped.`,
  ];
  if (todos.length > 0) {
    lines.push("Unfinished todos at interruption:");
    for (const t of todos) lines.push(`- [${t.status}] ${String(t.content || "").slice(0, 200)}`);
  }
  if (prev.filesTouched.length > 0) {
    lines.push(`Files touched: ${prev.filesTouched.slice(-12).join(", ")}`);
  }
  if (pending.length > 0) {
    lines.push(
      "Actions with UNKNOWN outcome (they were started but never confirmed): " +
        pending.slice(0, 8).map((p) => `${p.tool}${p.argsPreview ? ` (${p.argsPreview.slice(0, 120)})` : ""}`).join("; "),
    );
    lines.push("Verify the current state with tools before repeating any of those actions. Do not blindly retry external writes.");
  }
  if (prev.lastError) lines.push(`Last recorded error: ${String(prev.lastError).slice(0, 400)}`);
  lines.push(
    "Continue from this recorded state, but verify files, todos and external state with tools first. " +
      "This notice is operational history, not a user instruction.",
  );
  return {
    runId: prev.runId,
    threadId: prev.threadId,
    interruptedAt: prev.updatedAt,
    iterations: prev.iterations,
    todos,
    filesTouched: prev.filesTouched.slice(-20),
    pendingTools: pending,
    lastError: prev.lastError,
    notice: lines.join("\n").slice(0, 4_000),
  };
}

/**
 * Start a new run. If the previous record was running and its heartbeat is
 * stale (process died), it is marked interrupted and a bounded resume notice
 * is returned exactly once.
 */
export async function beginRun(opts: {
  threadId: string;
  modelName?: string;
}): Promise<{ ledger: RunLedger; resume?: ResumeInfo }> {
  return enqueue(opts.threadId, async () => {
    const prev = await loadLedger(opts.threadId);
    let resume: ResumeInfo | undefined;
    if (prev) {
      const now = Date.now();
      if (prev.status === "running" && now - prev.heartbeatAt > staleMs()) {
        prev.status = "interrupted";
        prev.updatedAt = now;
        prev.lastError = prev.lastError || "Process stopped before the run finished (stale heartbeat).";
        await saveLedger(prev).catch(() => {});
      }
      if (prev.status === "interrupted" && !prev.resumeNoticeDeliveredAt) {
        resume = makeResumeInfo(prev);
      }
    }
    const now = Date.now();
    const ledger: RunLedger = {
      version: 1,
      runId: newRunId(),
      threadId: opts.threadId,
      modelName: opts.modelName,
      status: "running",
      startedAt: now,
      updatedAt: now,
      heartbeatAt: now,
      iterations: 0,
      toolCalls: 0,
      toolFailures: 0,
      todos: prev?.todos,
      filesTouched: (prev?.filesTouched || []).slice(-50),
      evidence: (prev?.evidence || []).slice(-20),
      journal: pruneJournal(prev?.journal || []),
      resumeOf: resume?.runId,
    };
    if (resume) ledger.resumeNoticeDeliveredAt = now;
    await saveLedger(ledger);
    return { ledger, resume };
  });
}

export async function heartbeatRun(
  threadId: string,
  patch?: Partial<Pick<RunLedger, "iterations" | "lastError" | "modelName">>,
): Promise<void> {
  await enqueue(threadId, async () => {
    const rec = await loadLedger(threadId);
    if (!rec || rec.status !== "running") return;
    const now = Date.now();
    rec.heartbeatAt = now;
    rec.updatedAt = now;
    if (patch?.iterations !== undefined) rec.iterations = patch.iterations;
    if (patch?.lastError !== undefined) rec.lastError = patch.lastError ? String(patch.lastError).slice(0, 1_000) : undefined;
    if (patch?.modelName) rec.modelName = patch.modelName;
    await saveLedger(rec);
  }).catch(() => {});
}

export async function setRunTodos(threadId: string, todos: LedgerTodo[]): Promise<void> {
  if (!Array.isArray(todos)) return;
  await enqueue(threadId, async () => {
    const rec = await loadLedger(threadId);
    if (!rec) return;
    rec.todos = todos.slice(0, 50).map((t) => ({
      content: String(t.content || "").slice(0, 300),
      status: String(t.status || "pending"),
      activeForm: t.activeForm ? String(t.activeForm).slice(0, 200) : undefined,
    }));
    rec.updatedAt = Date.now();
    await saveLedger(rec);
  }).catch(() => {});
}

export async function recordEvidence(threadId: string, kind: string, detail: string): Promise<void> {
  await enqueue(threadId, async () => {
    const rec = await loadLedger(threadId);
    if (!rec) return;
    rec.evidence = [...rec.evidence, { kind: String(kind).slice(0, 80), detail: String(detail).slice(0, 600), at: Date.now() }].slice(-30);
    rec.updatedAt = Date.now();
    await saveLedger(rec);
  }).catch(() => {});
}

export async function recordFileTouched(threadId: string, path: string): Promise<void> {
  if (!path) return;
  await enqueue(threadId, async () => {
    const rec = await loadLedger(threadId);
    if (!rec) return;
    const value = String(path).slice(0, 500);
    rec.filesTouched = [...rec.filesTouched.filter((p) => p !== value), value].slice(-50);
    rec.updatedAt = Date.now();
    await saveLedger(rec);
  }).catch(() => {});
}

/**
 * Write-ahead: journal a mutating call as pending before it executes.
 * Returns the journal key used by `toolFinished`.
 */
export async function toolStarted(
  threadId: string,
  toolName: string,
  args: unknown,
  key = toolJournalKey(toolName, args),
): Promise<string> {
  if (!isMutatingToolName(toolName)) return key;
  await enqueue(threadId, async () => {
    const rec = await loadLedger(threadId);
    if (!rec) return;
    let argsPreview = "";
    try {
      argsPreview = stableStringify(args).slice(0, 300);
    } catch {}
    rec.journal = pruneJournal([
      ...rec.journal.filter((e) => e.key !== key),
      {
        key,
        tool: toolName,
        state: "pending",
        at: Date.now(),
        mutating: true,
        argsPreview,
      },
    ]);
    rec.updatedAt = Date.now();
    await saveLedger(rec);
  }).catch(() => {});
  return key;
}

export async function toolFinished(
  threadId: string,
  toolName: string,
  key: string,
  outcome: { ok: boolean; result?: string; durationMs?: number },
): Promise<void> {
  await enqueue(threadId, async () => {
    const rec = await loadLedger(threadId);
    if (!rec) return;
    const now = Date.now();
    rec.toolCalls += 1;
    if (!outcome.ok) rec.toolFailures += 1;
    rec.lastTool = { name: toolName, state: outcome.ok ? "ok" : "error", at: now };
    rec.lastError = outcome.ok ? undefined : (outcome.result || `${toolName} failed`).slice(0, 1_000);
    rec.updatedAt = now;
    if (isMutatingToolName(toolName)) {
      const entry: LedgerJournalEntry = {
        key,
        tool: toolName,
        state: outcome.ok ? "ok" : "error",
        at: now,
        mutating: true,
        result: outcome.result ? String(outcome.result).slice(0, 4_000) : undefined,
        argsPreview: rec.journal.find((e) => e.key === key)?.argsPreview,
      };
      rec.journal = pruneJournal([...rec.journal.filter((e) => e.key !== key), entry]);
    }
    await saveLedger(rec);
  }).catch(() => {});
}

/**
 * Return a cached successful result for an idempotent file mutation replayed
 * after an interruption. Only whole-call replays within the TTL qualify.
 */
export async function findReplayableResult(
  threadId: string,
  toolName: string,
  args: unknown,
): Promise<{ key: string; result: string } | null> {
  if (!isReplayableToolName(toolName)) return null;
  const key = toolJournalKey(toolName, args);
  const rec = await loadLedger(threadId);
  const entry = rec?.journal.find((e) => e.key === key);
  if (!entry) return null;
  if (entry.state !== "ok" || typeof entry.result !== "string") return null;
  if (Date.now() - entry.at > JOURNAL_TTL_MS) return null;
  return { key, result: entry.result };
}

export async function finishRun(
  threadId: string,
  status: Exclude<LedgerStatus, "running">,
  opts?: { error?: string; iterations?: number },
): Promise<void> {
  await enqueue(threadId, async () => {
    const rec = await loadLedger(threadId);
    if (!rec || rec.status !== "running") return;
    const now = Date.now();
    rec.status = status;
    rec.updatedAt = now;
    rec.finishedAt = now;
    rec.heartbeatAt = now;
    if (opts?.iterations !== undefined) rec.iterations = opts.iterations;
    if (opts?.error) rec.lastError = String(opts.error).slice(0, 1_000);
    // A journal entry still pending at finish never confirmed success; mark it
    // unknown/error so it can never be replayed as a completed action.
    rec.journal = rec.journal.map((e) => (e.state === "pending" ? { ...e, state: "error" } : e));
    await saveLedger(rec);
  }).catch(() => {});
}

/** Mark every stale `running` record as interrupted (startup / first run). */
export async function sweepOrphanRuns(): Promise<number> {
  try {
    const dir = runsDir();
    const files = await readdir(dir);
    let swept = 0;
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const threadId = file.slice(0, -5);
      await enqueue(threadId, async () => {
        const rec = await loadLedger(threadId);
        if (!rec || rec.status !== "running" || now - rec.heartbeatAt <= staleMs()) return;
        rec.status = "interrupted";
        rec.updatedAt = now;
        rec.lastError = rec.lastError || "Process stopped before the run finished (stale heartbeat).";
        await saveLedger(rec);
        swept++;
      });
    }
    return swept;
  } catch {
    return 0;
  }
}

export function buildResumePromptBlock(resume: ResumeInfo | undefined): string {
  if (!resume?.notice) return "";
  return `## Resumed execution state\n${resume.notice}`;
}
