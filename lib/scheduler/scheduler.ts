import { getTasks, updateTaskRunTime } from "./task-store";
import { getTask } from "./task-store";

let tickInterval: ReturnType<typeof setInterval> | null = null;
let running = false;
let missedExecutions: Map<string, number> = new Map(); // taskId -> missed count

export function startScheduler() {
  if (tickInterval) return;
  console.log("[scheduler] Starting scheduler (tick every 60s, heartbeat isolated)");
  // On start, check for missed executions (tasks that were due while offline)
  handleMissedExecutions().catch((e) => console.error("[scheduler] missed check failed:", e));
  tick();
  tickInterval = setInterval(tick, 60_000);
  // Unref'd: the interval must never keep a process alive on its own
  // (production is held up by the HTTP server; unit tests must exit).
  try {
    (tickInterval as any)?.unref?.();
  } catch {}
}

export function stopScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

async function handleMissedExecutions() {
  const tasks = await getTasks();
  const now = Date.now();
  for (const t of tasks) {
    if (!t.enabled) continue;
    // If nextRunAt is far in past (>2*interval), count as missed
    const intervalMs = t.schedule.intervalMinutes ? t.schedule.intervalMinutes * 60_000 : 60_000;
    const missedBy = now - t.nextRunAt;
    if (missedBy > intervalMs * 1.5 && missedBy < 24 * 3600000) {
      const count = missedExecutions.get(t.id) ?? 0;
      missedExecutions.set(t.id, count + 1);
      console.warn(`[scheduler] Task ${t.id} missed by ${Math.round(missedBy / 60000)} min — will run once and reschedule (deduplicated)`);
      // Don't run immediately here — tick() will pick it up, but we ensure deduplication: only one run per tick
    }
  }
}

async function executeHeartbeat(task: any): Promise<void> {
  const start = Date.now();
  const { loadHeartbeatState, recordHeartbeatTick, classifyHeartbeatNeed, consumeDueActions } = await import("./heartbeat-state");
  const state = await loadHeartbeatState();

  // Heartbeat is idempotent: if nothing due, remain silent
  const need = classifyHeartbeatNeed(state);
  // Load observability for tracking
  const { logEvent } = await import("@/lib/agent/observability");
  await logEvent({ threadId: "heartbeat", type: "heartbeat_tick", taskId: task.id, metadata: { need, consecutiveEmptyTicks: state.consecutiveEmptyTicks } } as any);

  if (need === "nothing" && state.consecutiveEmptyTicks > 3) {
    // Cheap deterministic sweep before staying silent (audit fix #9): the
    // checklist may be empty while the workspace has genuinely new work
    // (recent files, open durable goals). Wake the LLM only on a hash diff.
    try {
      const { runDiscoverySweep, isDiscoveryWorthy } = await import("./discovery");
      const sweep = await runDiscoverySweep();
      const { updateHeartbeatState } = await import("./heartbeat-state");
      if (isDiscoveryWorthy(sweep, (state as any).lastDiscoveryHash)) {
        await updateHeartbeatState({ lastDiscoveryHash: sweep.hash, lastDiscoveryAt: Date.now() } as any);
        console.log(`[heartbeat] Discovery diff — waking LLM: ${sweep.summary.slice(0, 160)}`);
        // Fall through to the LLM run with discovery context attached.
        const { executeTask } = await import("./task-executor");
        const discTask = {
          ...task,
          instructions: `${task.instructions}\n\n[Heartbeat discovery sweep (deterministic, no model): ${sweep.summary}. Recent files: ${sweep.recentFiles.slice(0, 8).join(", ") || "none"}. Open durable goals: ${sweep.openGoals}. Inspect ONLY what is new; Lane B prep is authorized for clearly-wanted reversible work; otherwise HEARTBEAT_OK.]`,
        };
        const result = await executeTask(discTask);
        await updateTaskRunTime(task.id, result.status === "success");
        const { recordHeartbeatTick } = await import("./heartbeat-state");
        await recordHeartbeatTick({ hadAction: result.status === "success" && !/heartbeat_ok/i.test((result.output || "").trim()), success: result.status === "success", actionDescription: `heartbeat(discovery): ${result.output.slice(0, 80)}`, taskId: task.id });
        return;
      }
      await updateHeartbeatState({ lastDiscoveryHash: sweep.hash, lastDiscoveryAt: Date.now() } as any);
    } catch (e) {
      console.warn("[heartbeat] discovery sweep failed (non-fatal):", e);
    }
    // Light silent tick — just update timestamp, no LLM call
    await recordHeartbeatTick({ hadAction: false, success: true });
    console.log(`[heartbeat] Silent tick — nothing actionable (empty ${state.consecutiveEmptyTicks})`);
    await logEvent({ threadId: "heartbeat", type: "heartbeat_skip", taskId: task.id, reason: "nothing actionable, silent" } as any);
    return;
  }

  // Autonomous: check for due pending/deferred actions and workspace changes
  let dueActions: Array<{ id: string; description: string; fileRefs?: string[] }> = [];
  try {
    dueActions = await consumeDueActions();
    if (dueActions.length > 0) {
      console.log(`[heartbeat] Consumed ${dueActions.length} due pending actions: ${dueActions.map(a=>a.description).join(" | ").slice(0,200)}`);
      await logEvent({ threadId: "heartbeat", type: "heartbeat_action", taskId: task.id, metadata: { dueActions: dueActions.map(a=>a.description) } } as any);
    }
  } catch (e) {
    console.warn("[heartbeat] consumeDueActions failed:", e);
  }

  // If need is proactive/failed_retry/in_progress but no dueActions, still run task to let LLM inspect workspace
  // Pass dueActions as augmented context so task executor can act proactively without re-discovering
  const augmentedTask = dueActions.length > 0
    ? { ...task, instructions: `${task.instructions}\n\n[Heartbeat autonomous context: ${dueActions.length} pending actions are now due: ${dueActions.map(a=>a.description).join("; ")}. Also check: pendingActions=${state.pendingActions.length}, failedActions=${state.failedActions.length}, consecutiveEmptyTicks=${state.consecutiveEmptyTicks}. Execute useful work if justified, otherwise remain silent with idempotent check.]` }
    : task;

  // Otherwise execute heartbeat task via executor but with heartbeat-specific telemetry
  const { executeTask } = await import("./task-executor");
  try {
    const result = await executeTask(augmentedTask);
    await updateTaskRunTime(task.id, result.status === "success");
    // No-loss dues (audit fix #6): an empty HEARTBEAT_OK or a failed tick
    // must NOT swallow consumed dues — re-queue them for the next tick/chat.
    const out = (result.output || "").trim().toLowerCase();
    const isQuiet = out === "" || out === "(no output)" || out.startsWith("heartbeat_ok");
    if ((isQuiet || result.status !== "success") && dueActions.length > 0) {
      try {
        const { requeueDueActions } = await import("./heartbeat-state");
        await requeueDueActions(dueActions);
        console.log(`[heartbeat] Re-queued ${dueActions.length} unconsumed due actions after ${isQuiet ? "quiet" : "failed"} tick`);
      } catch (e) {
        console.warn("[heartbeat] requeue failed:", e);
      }
    }
    const hadAction = dueActions.length > 0 || result.status === "success";
    await recordHeartbeatTick({ hadAction, success: result.status === "success", actionDescription: `heartbeat: ${result.output.slice(0, 80)}${dueActions.length? ` +${dueActions.length} due actions`:""}`, taskId: task.id });
    await logEvent({ threadId: "heartbeat", type: "heartbeat_action", taskId: task.id, status: result.status, latencyMs: Date.now() - start, metadata: { dueActionsConsumed: dueActions.length } } as any);
    console.log(`[heartbeat] Tick completed: ${result.status} (${result.duration}ms, need=${need}, due=${dueActions.length})`);
  } catch (error: any) {
    const msg = error?.message || String(error);
    await recordHeartbeatTick({ hadAction: false, success: false, error: msg, taskId: task.id });
    await logEvent({ threadId: "heartbeat", type: "heartbeat_tick", taskId: task.id, status: "error", reason: msg } as any);
    console.error("[heartbeat] Tick failed:", msg);
    // Do not throw — heartbeat failures must not block scheduled tasks
  }
}

async function executeScheduledTask(task: any): Promise<void> {
  const start = Date.now();
  const { logEvent } = await import("@/lib/agent/observability");
  await logEvent({ threadId: `task_${task.id}`, type: "scheduled_run", taskId: task.id, metadata: { schedule: task.schedule } } as any);
  const { executeTask } = await import("./task-executor");
  const now = Date.now();
  const intervalMs = task.schedule.intervalMinutes ? task.schedule.intervalMinutes * 60_000 : 0;
  // Deduplication: if this task was already run very recently (< interval/2), skip duplicate
  if (task.lastRunAt && intervalMs > 0 && now - task.lastRunAt < intervalMs * 0.5) {
    console.log(`[scheduler] Deduplicating task ${task.id} — last run ${Math.round((now - task.lastRunAt) / 1000)}s ago, interval ${intervalMs / 1000}s`);
    await logEvent({ threadId: `task_${task.id}`, type: "scheduled_run", taskId: task.id, status: "deduplicated", reason: "duplicate trigger too soon" } as any);
    return;
  }
  // Timezone handling: store times as UTC ms; display respects local but execution is UTC-based
  try {
    console.log(`[scheduler] Running scheduled task: ${task.name} (${task.id}) kind=${task.schedule.kind}`);
    const result = await executeTask(task);
    await updateTaskRunTime(task.id, result.status === "success");
    console.log(`[scheduler] Task ${task.id} completed: ${result.status} (${result.duration}ms)`);
    await logEvent({ threadId: `task_${task.id}`, type: "scheduled_run", taskId: task.id, status: result.status, latencyMs: result.duration } as any);
    // Proactive announcement: a finished scheduled task must be volunteered
    // at the start of the user's next chat, not sit silently in the log
    // until asked about. Meaningless/empty outputs are skipped inside.
    if (result.status === "success") {
      try {
        const { recordAnnouncement } = await import("./announcements");
        await recordAnnouncement({ taskId: task.id, taskName: task.name, output: result.output });
      } catch {}
    }
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`[scheduler] Task ${task.id} failed:`, msg);
    await logEvent({ threadId: `task_${task.id}`, type: "scheduled_run", taskId: task.id, status: "error", reason: msg } as any);
    // On failure, still update nextRunAt via updateTaskRunTime but mark as error for retry logic
    try {
      await updateTaskRunTime(task.id, false);
    } catch {}
    // Retry logic: next tick will retry if still due; we also track missed
    missedExecutions.set(task.id, (missedExecutions.get(task.id) ?? 0) + 1);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const tasks = await getTasks();
    const now = Date.now();
    const dueTasks = tasks.filter((t) => t.enabled && t.nextRunAt <= now);

    if (dueTasks.length === 0) return;

    // Separate heartbeat from scheduled tasks — they must not interfere
    const heartbeatTasks = dueTasks.filter((t) => t.type === "heartbeat" || t.id === "heartbeat");
    const scheduledTasks = dueTasks.filter((t) => t.type !== "heartbeat" && t.id !== "heartbeat");

    // Execute heartbeat first (if any), isolated, never blocking scheduled tasks
    for (const hb of heartbeatTasks) {
      await executeHeartbeat(hb);
    }

    // Execute scheduled tasks sequentially with bounded concurrency (1 at a time to avoid interleaving)
    // Future: bounded concurrency pool if needed, but keep isolation
    for (const task of scheduledTasks) {
      await executeScheduledTask(task);
    }

    // Clear missed tracking for tasks that succeeded
    for (const t of dueTasks) {
      if (missedExecutions.has(t.id)) missedExecutions.delete(t.id);
    }
  } catch (error) {
    console.error("[scheduler] Tick error:", error);
    try {
      const { logEvent } = await import("@/lib/agent/observability");
      await logEvent({ threadId: "scheduler", type: "scheduler_tick", status: "error", reason: String(error) } as any);
    } catch {}
  } finally {
    running = false;
  }
}
