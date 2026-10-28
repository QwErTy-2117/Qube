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
  pendingActions: Array<{ id: string; description: string; createdAt: number; deferredUntil?: number; fileRefs?: string[]; contentHash?: string }>;
  deferredActions: Array<{ id: string; description: string; deferredUntil: number }>;
  failedActions: Array<{ id: string; description: string; failedAt: number; retryAt: number; attempts: number; lastError: string }>;
  taskStatus: Record<string, "idle" | "in_progress" | "failed" | "needs_attention">;
  notificationStatus: Record<string, { lastNotifiedAt: number; count: number }>;
  consecutiveEmptyTicks: number;
  totalTicks: number;
  lastDiscoveryHash?: string | null;
  lastDiscoveryAt?: number | null;
  /** Full work/connector discovery hash (heartbeat v2). */
  lastWorkDiscoveryHash?: string | null;
  lastWorkDiscoveryAt?: number | null;
  lastConnectorHash?: string | null;
  lastConnectorCheckAt?: number | null;
  connectedApps?: string[];
  openWorkCount?: number;
  pendingApprovalCount?: number;
  lastWorkAt?: number | null;
  lastWorkOutput?: string | null;
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
    lastDiscoveryHash: null,
    lastDiscoveryAt: null,
    lastWorkDiscoveryHash: null,
    lastWorkDiscoveryAt: null,
    lastConnectorHash: null,
    lastConnectorCheckAt: null,
    connectedApps: [],
    openWorkCount: 0,
    pendingApprovalCount: 0,
    lastWorkAt: null,
    lastWorkOutput: null,
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
  if (Object.values(state.taskStatus).some((s) => s === "in_progress") || (state.openWorkCount ?? 0) > 0) return "in_progress";
  if (state.failedActions.some((f) => f.retryAt <= Date.now())) return "failed_retry";
  if (Object.values(state.taskStatus).some((s) => s === "needs_attention") || (state.pendingApprovalCount ?? 0) > 0) return "needs_attention";
  if (state.pendingActions.some((a) => !a.deferredUntil || a.deferredUntil <= Date.now())) return "proactive";
  if (state.deferredActions.some((a) => a.deferredUntil <= Date.now())) return "later";
  return "nothing";
}

export async function addPendingAction(description: string, deferredUntil?: number, fileRefs?: string[]): Promise<{ added: boolean; duplicate: boolean }> {
  const state = await loadHeartbeatState();
  const norm = description.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
  // Content-hash dedup (unified with proactive suggestions): same fingerprint
  // => duplicate even if wording drifts slightly. Falls back to the legacy
  // normalized-prefix match for entries recorded before hashes existed.
  let hash = "";
  try {
    const { hashContent } = await import("@/lib/proactivity/store");
    hash = hashContent(description.toLowerCase().slice(0, 2000));
  } catch {}
  const isDupe = (d: string, h?: string) => {
    if (hash && h && h === hash) return true;
    const n = d.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
    return n === norm || (norm.length > 24 && n.startsWith(norm.slice(0, 48))) || (n.length > 24 && norm.startsWith(n.slice(0, 48)));
  };
  if (state.pendingActions.some((a) => isDupe(a.description, (a as any).contentHash))) return { added: false, duplicate: true };
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  for (const [key, entry] of Object.entries(state.notificationStatus)) {
    if (entry.lastNotifiedAt > weekAgo && isDupe(key)) return { added: false, duplicate: true };
  }
  const id = `hbact_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
  state.pendingActions.push({ id, description, createdAt: Date.now(), deferredUntil, ...(fileRefs?.length ? { fileRefs: fileRefs.slice(0, 8) } : {}), ...(hash ? { contentHash: hash } : {}) });
  await saveHeartbeatState(state);
  return { added: true, duplicate: false };
}

/** Mark a checklist topic as surfaced to the user (so it never repeats). */
export async function markNotified(topic: string): Promise<void> {
  const state = await loadHeartbeatState();
  const key = topic.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
  const prev = state.notificationStatus[key];
  state.notificationStatus[key] = { lastNotifiedAt: Date.now(), count: (prev?.count ?? 0) + 1 };
  await saveHeartbeatState(state);
}

export async function hasBeenNotified(topic: string, windowMs = 7 * 24 * 3600 * 1000): Promise<boolean> {
  const state = await loadHeartbeatState();
  const key = topic.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
  const entry = state.notificationStatus[key];
  if (!entry) return false;
  return Date.now() - entry.lastNotifiedAt < windowMs;
}

export async function consumeDueActions(): Promise<Array<{ id: string; description: string; fileRefs?: string[] }>> {
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
  return [
    ...due.map(({ id, description, fileRefs }) => ({ id, description, ...(fileRefs ? { fileRefs } : {}) })),
    ...dueDeferred.map(({ id, description }) => ({ id, description })),
  ];
}

/** Re-queue dues that were consumed but NOT acted on (empty/failed tick) so
 * they are never lost. Dedups against anything re-added meanwhile. */
export async function requeueDueActions(due: Array<{ description: string; fileRefs?: string[] }>): Promise<void> {
  if (due.length === 0) return;
  for (const d of due) {
    try {
      await addPendingAction(d.description, undefined, d.fileRefs);
    } catch {}
  }
}

export async function shouldSkipHeartbeatDueToQuiet(state: HeartbeatState, minIntervalMs: number): Promise<boolean> {
  if (!state.lastHeartbeat) return false;
  const since = Date.now() - state.lastHeartbeat;
  // If we've had many empty ticks in a row, we can back off (but still tick via scheduler interval)
  // This function is advisory; caller decides to remain silent vs do light check
  if (state.consecutiveEmptyTicks > 5 && since < minIntervalMs) return true;
  return false;
}
