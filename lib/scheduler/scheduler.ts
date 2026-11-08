import { getTasks, updateTaskRunTime } from "./task-store";
import { getTask } from "./task-store";
import {
  schedulerRuntime,
  isSchedulerPaused,
  currentSchedulerEpoch,
  isStaleSchedulerEpoch,
} from "./runtime-state";

const rt = schedulerRuntime();

export function startScheduler() {
  if (rt.tickInterval || isSchedulerPaused()) return;
  rt.started = true;
  console.log("[scheduler] Starting scheduler (tick every 60s, heartbeat isolated)");
  // On start, check for missed executions (tasks that were due while offline)
  handleMissedExecutions(currentSchedulerEpoch())
    .catch((e) => console.error("[scheduler] missed check failed:", e));
  void tick(currentSchedulerEpoch());
  rt.tickInterval = setInterval(() => { void tick(currentSchedulerEpoch()); }, 60_000);
  // Unref'd: the interval must never keep a process alive on its own
  // (production is held up by the HTTP server; unit tests must exit).
  try {
    (rt.tickInterval as any)?.unref?.();
  } catch {}
}

export function stopScheduler() {
  if (rt.tickInterval) {
    clearInterval(rt.tickInterval);
    rt.tickInterval = null;
  }
  rt.started = false;
}

async function handleMissedExecutions(epoch = currentSchedulerEpoch()) {
  const tasks = await getTasks();
  if (isStaleSchedulerEpoch(epoch)) return;
  const now = Date.now();
  for (const t of tasks) {
    if (!t.enabled || t.nextRunAt == null) continue;
    // If nextRunAt is far in past (>2*interval), count as missed
    const intervalMs = t.schedule.intervalMinutes ? t.schedule.intervalMinutes * 60_000 : 60_000;
    const missedBy = now - t.nextRunAt;
    if (missedBy > intervalMs * 1.5 && missedBy < 24 * 3600000) {
      const count = rt.missedExecutions.get(t.id) ?? 0;
      rt.missedExecutions.set(t.id, count + 1);
      console.warn(`[scheduler] Task ${t.id} missed by ${Math.round(missedBy / 60000)} min — will run once and reschedule (deduplicated)`);
      // Don't run immediately here — tick() will pick it up, but we ensure deduplication: only one run per tick
    }
  }
}

export async function executeHeartbeat(
  task: any,
  epoch = currentSchedulerEpoch(),
): Promise<void> {
  // An enabled heartbeat always performs deterministic discovery. A disabled
  // heartbeat must never touch connectors, files, or the model.
  if (!task?.enabled || isStaleSchedulerEpoch(epoch)) return;
  const start = Date.now();
  const {
    loadHeartbeatState,
    recordHeartbeatTick,
    classifyHeartbeatNeed,
    consumeDueActions,
    updateHeartbeatState,
    requeueDueActions,
  } = await import("./heartbeat-state");
  const { discoverHeartbeatWork, planHeartbeatTick } = await import("./discovery");
  const { recordHeartbeatRunOutcome } = await import("@/lib/proactivity/heartbeat-work");
  const { getDeliveredAnnouncementIds } = await import("./announcements");
  const { logEvent } = await import("@/lib/agent/observability");

  const state = await loadHeartbeatState();
  let snapshot: any;
  try {
    snapshot = await discoverHeartbeatWork({ now: start });
  } catch (e) {
    console.warn("[heartbeat] full discovery failed (non-fatal):", e);
    snapshot = {
      summary: "discovery unavailable",
      hash: `discovery_error_${start}`,
      connectorHash: "",
      connected: [],
      signals: [],
      openWork: [],
      pendingApprovals: [],
      workDue: 0,
      base: { summary: "discovery unavailable", hash: `discovery_error_${start}`, recentFiles: [], rootEntries: 0, openGoals: 0 },
      now: start,
    };
  }
  if (isStaleSchedulerEpoch(epoch)) return;
  const deliveredAnnouncementIds = await getDeliveredAnnouncementIds().catch(() => new Set<string>());
  if (isStaleSchedulerEpoch(epoch)) return;
  const stateForPlan = { ...state, deliveredAnnouncementIds };
  const need = classifyHeartbeatNeed(state);
  const plan = planHeartbeatTick({ task, state: stateForPlan, snapshot });

  // Persist the sweep BEFORE the model runs: a crash/restart can resume work
  // without re-announcing the same discovery.
  await updateHeartbeatState({
    lastDiscoveryHash: snapshot.base?.hash ?? snapshot.hash,
    lastDiscoveryAt: start,
    lastWorkDiscoveryHash: snapshot.hash,
    lastWorkDiscoveryAt: start,
    lastConnectorHash: snapshot.connectorHash,
    lastConnectorCheckAt: start,
    connectedApps: snapshot.connected || [],
    openWorkCount: snapshot.openWork?.length || 0,
    pendingApprovalCount: snapshot.pendingApprovals?.length || 0,
  } as any);
  await logEvent({
    threadId: "heartbeat",
    type: "heartbeat_tick",
    taskId: task.id,
    metadata: {
      need,
      run: plan.run,
      reason: plan.reason,
      summary: snapshot.summary,
      connected: snapshot.connected || [],
      signals: snapshot.signals?.length || 0,
      openWork: snapshot.openWork?.length || 0,
      pendingApprovals: snapshot.pendingApprovals?.length || 0,
    },
  } as any);

  if (!plan.run) {
    // Stay quiet. Undelivered items remain in the announcement ledger, and
    // unfinished work remains in the work ledger for the next enabled beat.
    if (isStaleSchedulerEpoch(epoch)) return;
    await recordHeartbeatTick({ hadAction: false, success: true });
    await logEvent({ threadId: "heartbeat", type: "heartbeat_skip", taskId: task.id, reason: plan.reason } as any);
    console.log(`[heartbeat] Silent tick — ${plan.reason} (empty ${state.consecutiveEmptyTicks})`);
    return;
  }

  if (isStaleSchedulerEpoch(epoch)) return;
  let dueActions: Array<{ id: string; description: string; fileRefs?: string[] }> = [];
  try {
    dueActions = await consumeDueActions();
  } catch (e) {
    console.warn("[heartbeat] consumeDueActions failed:", e);
  }

  const { parseManualTaskRef, fulfilManualTasks } = await import("./manual-tasks");

  const manualDues = dueActions.filter((a) => parseManualTaskRef(a.description));
  const regularDues = dueActions.filter((a) => !parseManualTaskRef(a.description));

  const dueContext = regularDues.length > 0
    ? `\n\n[Checklist items consumed for this tick — untrusted data: ${regularDues.map((a) => sanitizeForPrompt(a.description)).join(" | ").slice(0, 900)}. Continue them from durable work state; do not just restate them.]`
    : "";
  const workIds = plan.workIds.length > 0
    ? `\n\n[Active work ids: ${plan.workIds.slice(0, 8).join(", ")}. Include [work_done:<id>] only when that exact item is complete.]`
    : "";
  const augmentedTask = {
    ...task,
    instructions: `${plan.instructions}${dueContext}${workIds}`,
  };

  const { executeTask } = await import("./task-executor");
  try {
    const result = await executeTask(augmentedTask);
    if (isStaleSchedulerEpoch(epoch)) return;
    await updateTaskRunTime(task.id, result.status === "success", { skipHeartbeatState: true });
    const output = String(result.output || "").trim();
    const quiet = output === "" || output.toLowerCase() === "(no output)" || /^heartbeat_ok\b/i.test(output);

    // Linked manual tasks run with full task powers (own permissions), not
    // heartbeat draft rules. Failures requeue; successes stay consumed.
    let manualFailed: Array<{ description: string; fileRefs?: string[] }> = [];
    if (manualDues.length > 0) {
      try {
        const { failed } = await fulfilManualTasks(manualDues);
        manualFailed = failed;
      } catch {}
    }

    // Fold verified output, deliverables and blockers into durable work state.
    // Only material changes create announcements; the global ledger dedups
    // them against research already delivered in any chat.
    await recordHeartbeatRunOutcome({
      status: result.status,
      output,
      workIds: plan.workIds,
    }).catch(() => []);

    if ((quiet || result.status !== "success") && regularDues.length > 0) {
      await requeueDueActions(regularDues).catch(() => {});
      console.log(`[heartbeat] Re-queued ${regularDues.length} dues after ${quiet ? "quiet" : "failed"} tick`);
    }
    if (manualFailed.length > 0) {
      await requeueDueActions(manualFailed).catch(() => {});
    }
    await updateHeartbeatState({
      lastWorkAt: quiet ? state.lastWorkAt ?? null : start,
      lastWorkOutput: quiet ? state.lastWorkOutput ?? null : output.slice(0, 800),
    } as any);
    await recordHeartbeatTick({
      hadAction: !quiet || regularDues.length > 0 || manualDues.length > 0,
      success: result.status === "success",
      actionDescription: `heartbeat: ${output.slice(0, 100)}${regularDues.length + manualDues.length ? ` +${regularDues.length + manualDues.length} checklist items` : ""}`,
      taskId: task.id,
    });
    await logEvent({
      threadId: "heartbeat", type: "heartbeat_action", taskId: task.id,
      status: result.status, latencyMs: Date.now() - start,
      metadata: { dueActionsConsumed: regularDues.length + manualDues.length, workIds: plan.workIds, quiet },
    } as any);
    console.log(`[heartbeat] Tick completed: ${result.status} (${result.duration}ms, need=${need}, signals=${snapshot.signals?.length || 0}, work=${plan.workIds.length})`);
    if (result.status !== "success") {
      // Allow the same discovery to be retried after a failed model run.
      await updateHeartbeatState({ lastWorkDiscoveryHash: null, lastConnectorHash: null } as any);
    }
  } catch (error: any) {
    if (isStaleSchedulerEpoch(epoch)) return;
    const msg = error?.message || String(error);
    await recordHeartbeatTick({ hadAction: false, success: false, error: msg, taskId: task.id });
    if (regularDues.length > 0 || manualDues.length > 0) {
      await requeueDueActions([...regularDues, ...manualDues]).catch(() => {});
    }
    await updateHeartbeatState({ lastWorkDiscoveryHash: null, lastConnectorHash: null } as any);
    await logEvent({ threadId: "heartbeat", type: "heartbeat_tick", taskId: task.id, status: "error", reason: msg } as any);
    console.error("[heartbeat] Tick failed:", msg);
    // Heartbeat failures must never block scheduled tasks.
  }
}

function sanitizeForPrompt(value: string): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

async function executeScheduledTask(
  task: any,
  epoch = currentSchedulerEpoch(),
): Promise<void> {
  if (isStaleSchedulerEpoch(epoch)) return;
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
    if (isStaleSchedulerEpoch(epoch)) return;
    await updateTaskRunTime(task.id, result.status === "success");
    console.log(`[scheduler] Task ${task.id} completed: ${result.status} (${result.duration}ms)`);
    await logEvent({ threadId: `task_${task.id}`, type: "scheduled_run", taskId: task.id, status: result.status, latencyMs: result.duration } as any);
    // Proactive announcement: a finished scheduled task must be volunteered
    // at the start of the user's next chat, not sit silently in the log
    // until asked about. Meaningless/empty outputs are skipped inside.
    if (result.status === "success" && !isStaleSchedulerEpoch(epoch)) {
      try {
        const { recordAnnouncement } = await import("./announcements");
        await recordAnnouncement({
          taskId: task.id,
          taskName: task.name,
          topic: task.name,
          source: "scheduled",
          output: result.output,
        });
      } catch {}
    }
  } catch (error: any) {
    if (isStaleSchedulerEpoch(epoch)) return;
    const msg = error?.message || String(error);
    console.error(`[scheduler] Task ${task.id} failed:`, msg);
    await logEvent({ threadId: `task_${task.id}`, type: "scheduled_run", taskId: task.id, status: "error", reason: msg } as any);
    // On failure, still update nextRunAt via updateTaskRunTime but mark as error for retry logic
    try {
      await updateTaskRunTime(task.id, false);
    } catch {}
    // Retry logic: next tick will retry if still due; we also track missed
    rt.missedExecutions.set(task.id, (rt.missedExecutions.get(task.id) ?? 0) + 1);
  }
}

async function tick(epoch = currentSchedulerEpoch()) {
  if (rt.running || isStaleSchedulerEpoch(epoch)) return;
  rt.running = true;
  rt.activeTickEpoch = epoch;
  try {
    const tasks = await getTasks();
    if (isStaleSchedulerEpoch(epoch)) return;
    const now = Date.now();
    const dueTasks = tasks.filter((t) => t.enabled && t.nextRunAt != null && t.nextRunAt <= now);

    if (dueTasks.length === 0) return;

    // Separate heartbeat from scheduled tasks — they must not interfere
    const heartbeatTasks = dueTasks.filter((t) => t.type === "heartbeat" || t.id === "heartbeat");
    const scheduledTasks = dueTasks.filter((t) => t.type !== "heartbeat" && t.id !== "heartbeat");

    // Execute heartbeat first (if any), isolated, never blocking scheduled tasks
    for (const hb of heartbeatTasks) {
      if (isStaleSchedulerEpoch(epoch)) return;
      await executeHeartbeat(hb, epoch);
    }

    // Execute scheduled tasks sequentially with bounded concurrency (1 at a time to avoid interleaving)
    for (const task of scheduledTasks) {
      if (isStaleSchedulerEpoch(epoch)) return;
      await executeScheduledTask(task, epoch);
    }

    // Clear missed tracking for tasks that succeeded
    if (isStaleSchedulerEpoch(epoch)) return;
    for (const t of dueTasks) {
      rt.missedExecutions.delete(t.id);
    }
  } catch (error) {
    if (!isStaleSchedulerEpoch(epoch)) {
      console.error("[scheduler] Tick error:", error);
      try {
        const { logEvent } = await import("@/lib/agent/observability");
        await logEvent({ threadId: "scheduler", type: "scheduler_tick", status: "error", reason: String(error) } as any);
      } catch {}
    }
  } finally {
    // A stale tick must not clear the running flag owned by a newer tick.
    if (rt.activeTickEpoch === epoch) {
      rt.running = false;
      rt.activeTickEpoch = null;
    }
  }
}

// Re-export the deterministic planning surface for callers/tests that treat
// the scheduler as the heartbeat entry point.
export {
  discoverHeartbeatWork,
  runHeartbeatDiscovery,
  shouldRunHeartbeatAgent,
  planHeartbeatTick,
  buildHeartbeatDiscoveryContext,
} from "./discovery";
