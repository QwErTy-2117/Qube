import { addPendingAction, loadHeartbeatState, saveHeartbeatState } from "./heartbeat-state";
import { getTasks, getTask, updateTaskRunTime } from "./task-store";

const MARKER = "manual-task";

/** Machine-readable link between a none-schedule task and its heartbeat reminder. */
export function manualTaskMarker(taskId: string, name: string, instructions: string): string {
  const human = `${name} — ${instructions}`.replace(/\s+/g, " ").trim().slice(0, 200);
  return `[${MARKER}:${taskId}] ${human}`;
}

export function parseManualTaskRef(description: string): string | null {
  const m = /\[manual-task:([^\]]+)\]/.exec(String(description || ""));
  return m ? m[1] : null;
}

/** Save (or refresh) the heartbeat reminder for a none-schedule task. */
export async function linkManualTaskReminder(
  taskId: string,
  name: string,
  instructions: string,
): Promise<void> {
  const description = manualTaskMarker(taskId, name, instructions);
  const state = await loadHeartbeatState();
  const existing = state.pendingActions.find(
    (action) => parseManualTaskRef(action.description) === taskId,
  );
  if (existing) {
    existing.description = description;
    delete (existing as { contentHash?: string }).contentHash;
    await saveHeartbeatState(state);
    return;
  }
  await addPendingAction(description);
}

/** Remove the heartbeat reminder for a task (manual run, delete). Best-effort. */
export async function unlinkManualTaskReminder(taskId: string): Promise<void> {
  const state = await loadHeartbeatState();
  const kept = state.pendingActions.filter((a) => parseManualTaskRef(a.description) !== taskId);
  if (kept.length !== state.pendingActions.length) {
    await saveHeartbeatState({ ...state, pendingActions: kept });
  }
}

/**
 * Ensure every enabled manual task still has exactly one heartbeat reminder.
 * Older records predate the link (or survived a migration), so opening the
 * board repairs them without duplicating anything.
 */
export async function syncManualTaskReminders(): Promise<void> {
  const tasks = await getTasks();
  const manual = tasks.filter(
    (task) =>
      task.type === "scheduled" &&
      task.schedule.kind === "none" &&
      task.enabled &&
      task.lastRunAt == null,
  );
  const state = await loadHeartbeatState();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const keptActions = state.pendingActions.filter((action) => {
    const taskId = parseManualTaskRef(action.description);
    if (!taskId) return true;
    const task = byId.get(taskId);
    return Boolean(
      task &&
        task.type === "scheduled" &&
        task.schedule.kind === "none" &&
        task.enabled &&
        task.lastRunAt == null,
    );
  });
  let changed = keptActions.length !== state.pendingActions.length;
  if (changed) state.pendingActions = keptActions;
  const linked = new Set(
    state.pendingActions
      .map((action) => parseManualTaskRef(action.description))
      .filter((id): id is string => Boolean(id)),
  );
  const now = Date.now();
  for (const task of manual) {
    if (linked.has(task.id)) continue;
    state.pendingActions.push({
      id: `hbact_${now}_${Math.random().toString(36).slice(2, 6)}`,
      description: manualTaskMarker(task.id, task.name, task.instructions),
      createdAt: now,
    });
    changed = true;
  }
  if (changed) await saveHeartbeatState(state);
}

export async function fulfilManualTasks(
  dues: Array<{ id: string; description: string; fileRefs?: string[] }>,
): Promise<{ succeeded: string[]; failed: Array<{ taskId: string; description: string; fileRefs?: string[] }> }> {
  const { executeTask } = await import("./task-executor");
  const { recordAnnouncement } = await import("./announcements");
  const succeeded: string[] = [];
  const failed: Array<{ taskId: string; description: string; fileRefs?: string[] }> = [];
  for (const due of dues) {
    const taskId = parseManualTaskRef(due.description);
    if (!taskId) continue;
    const task = await getTask(taskId);
    if (!task || !task.enabled || task.schedule.kind !== "none" || task.lastRunAt != null) continue;
    const result = await executeTask(task);
    if (result.status === "success") {
      await updateTaskRunTime(task.id, true);
      try {
        await recordAnnouncement({ taskId: task.id, taskName: task.name, topic: task.name, source: "scheduled", output: result.output });
      } catch {}
      succeeded.push(taskId);
    } else {
      failed.push({ taskId, description: due.description, ...(due.fileRefs ? { fileRefs: due.fileRefs } : {}) });
    }
  }
  return { succeeded, failed };
}
