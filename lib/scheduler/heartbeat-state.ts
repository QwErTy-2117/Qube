/**
 * Heartbeat state machine — distinct from scheduled tasks.
 *
 * Per spec:
 * - Heartbeat = periodic autonomous inspection (lightweight proactive decisions)
 * - Scheduled task = deterministic work at particular time/interval
 * - Heartbeat must be: idempotent, state-aware, quiet when nothing to do,
 *   tracking last heartbeat, last successful check, retry times, task status.
 *
 * This module persists heartbeat state so ticks are idempotent across restarts.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

const STATE_FILE = join(getDataDir(), ".memory", "heartbeat-state.json");

export type HeartbeatState = {
  lastHeartbeat: number | null;
  lastSuccessfulCheck: number | null;
  lastAttemptedCheck: number | null;
  lastAction: string | null;
  lastActionAt: number | null;
  pendingActions: Array<{ id: string; description: string; createdAt: number; deferredUntil?: number }>;
  deferredActions: Array<{ id: string; description: string; deferredUntil: number }>;
  failedActions: Array<{ id: string; description: string; failedAt: number; retryAt: number; attempts: number; lastError: string }>;
  taskStatus: Record<string, "idle" | "in_progress" | "failed" | "needs_attention">;
  notificationStatus: Record<string, { lastNotifiedAt: number; count: number }>;
  consecutiveEmptyTicks: number;
  totalTicks: number;
};

function defaultState(): HeartbeatState {
  return {
    lastHeartbeat: null,
    lastSuccessfulCheck: null,
    lastAttemptedCheck: null,
    lastAction: null,
    lastActionAt: null,
    pendingActions: [],
    deferredActions: [],
    failedActions: [],
    taskStatus: {},
    notificationStatus: {},
    consecutiveEmptyTicks: 0,
    totalTicks: 0,
  };
}

async function ensureDir() {
  const dir = join(getDataDir(), ".memory");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

export async function loadHeartbeatState(): Promise<HeartbeatState> {
  await ensureDir();
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    const raw = await readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

export async function saveHeartbeatState(state: HeartbeatState): Promise<void> {
  await ensureDir();
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export async function updateHeartbeatState(patch: Partial<HeartbeatState>): Promise<HeartbeatState> {
  const state = await loadHeartbeatState();
  const next = { ...state, ...patch } as HeartbeatState;
  await saveHeartbeatState(next);
  return next;
}

export async function recordHeartbeatTick(opts: {
  hadAction: boolean;
  actionDescription?: string;
  success?: boolean;
  error?: string;
  taskId?: string;
}): Promise<HeartbeatState> {
  const state = await loadHeartbeatState();
  const now = Date.now();
  state.lastHeartbeat = now;
  state.lastAttemptedCheck = now;
  state.totalTicks++;

  if (opts.hadAction) {
    state.lastAction = opts.actionDescription ?? "heartbeat action";
    state.lastActionAt = now;
    if (opts.success !== false) state.lastSuccessfulCheck = now;
    state.consecutiveEmptyTicks = 0;
    if (opts.taskId) state.taskStatus[opts.taskId] = opts.success === false ? "failed" : "idle";
  } else {
    state.consecutiveEmptyTicks++;
    if (opts.success !== false) state.lastSuccessfulCheck = now;
  }

  if (opts.error && opts.taskId) {
    const existing = state.failedActions.find((f) => f.id === opts.taskId);
    if (existing) {
      existing.attempts++;
      existing.lastError = opts.error;
      existing.failedAt = now;
      existing.retryAt = now + Math.min(60000 * Math.pow(2, existing.attempts), 3600000);
    } else {
      state.failedActions.push({
        id: opts.taskId ?? `hb_${now}`,
        description: opts.actionDescription ?? "heartbeat action",
        failedAt: now,
        retryAt: now + 60000,
        attempts: 1,
        lastError: opts.error,
      });
    }
  }

  // Clear retryable failed actions whose retryAt has passed — caller will re-attempt and then remove on success
  // Prune old pending/deferred that are overdue by >7 days
  const cutoff = now - 7 * 24 * 3600 * 1000;
  state.pendingActions = state.pendingActions.filter((a) => !a.deferredUntil || a.deferredUntil > cutoff);
  state.failedActions = state.failedActions.filter((f) => f.failedAt > cutoff);

  await saveHeartbeatState(state);
  return state;
}

export function classifyHeartbeatNeed(state: HeartbeatState): "nothing" | "later" | "in_progress" | "failed_retry" | "needs_attention" | "proactive" {
  if (Object.values(state.taskStatus).some((s) => s === "in_progress")) return "in_progress";
  if (state.failedActions.some((f) => f.retryAt <= Date.now())) return "failed_retry";
  if (Object.values(state.taskStatus).some((s) => s === "needs_attention")) return "needs_attention";
  if (state.pendingActions.some((a) => !a.deferredUntil || a.deferredUntil <= Date.now())) return "proactive";
  if (state.deferredActions.some((a) => a.deferredUntil <= Date.now())) return "later";
  return "nothing";
}

export async function addPendingAction(description: string, deferredUntil?: number): Promise<void> {
  const state = await loadHeartbeatState();
  const id = `hbact_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
  state.pendingActions.push({ id, description, createdAt: Date.now(), deferredUntil });
  await saveHeartbeatState(state);
}

export async function consumeDueActions(): Promise<Array<{ id: string; description: string }>> {
  const state = await loadHeartbeatState();
  const now = Date.now();
  const due = state.pendingActions.filter((a) => !a.deferredUntil || a.deferredUntil <= now);
  if (due.length === 0) return [];
  state.pendingActions = state.pendingActions.filter((a) => a.deferredUntil && a.deferredUntil > now);
  // also promote deferred that are due
  const dueDeferred = state.deferredActions.filter((a) => a.deferredUntil <= now);
  state.deferredActions = state.deferredActions.filter((a) => a.deferredUntil > now);
  for (const d of dueDeferred) state.pendingActions.push({ id: d.id, description: d.description, createdAt: now });
  await saveHeartbeatState(state);
  return [...due, ...dueDeferred].map(({ id, description }) => ({ id, description }));
}

export async function shouldSkipHeartbeatDueToQuiet(state: HeartbeatState, minIntervalMs: number): Promise<boolean> {
  if (!state.lastHeartbeat) return false;
  const since = Date.now() - state.lastHeartbeat;
  // If we've had many empty ticks in a row, we can back off (but still tick via scheduler interval)
  // This function is advisory; caller decides to remain silent vs do light check
  if (state.consecutiveEmptyTicks > 5 && since < minIntervalMs) return true;
  return false;
}
