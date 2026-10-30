import { addPendingAction, loadHeartbeatState, saveHeartbeatState } from "./heartbeat-state";
import { getTask, updateTaskRunTime } from "./task-store";

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
export async function linkManualTaskReminder(taskId: string, name: string, instructions: string): Promise<void> {
  await addPendingAction(manualTaskMarker(taskId, name, instructions));
}

/** Remove the heartbeat reminder for a task (manual run, delete). Best-effort. */
export async function unlinkManualTaskReminder(taskId: string): Promise<void> {
  const state = await loadHeartbeatState();
  const kept = state.pendingActions.filter((a) => parseManualTaskRef(a.description) !== taskId);
  if (kept.length !== state.pendingActions.length) {
    await saveHeartbeatState({ ...state, pendingActions: kept });
  }
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
