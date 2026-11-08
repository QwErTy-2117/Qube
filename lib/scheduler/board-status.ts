import type { ScheduledTask } from "./types";

/**
 * Board status for one scheduled task: Done means it actually ran and the
 * current period has not rolled over. Recurring tasks trust the persisted
 * nextRunAt (advanced on every run), so interval and wall-clock schedules
 * (hour/minute/weekdays/monthDay) all behave the same. Takes a Pick so both
 * the store type and the UI-local task interface satisfy it without casts.
 * Pure — unit-tested in tests/board-status.test.ts. Unknown shapes default
 * to not-done.
 */
export function isTaskDone(
  task: Pick<ScheduledTask, "schedule" | "lastRunAt" | "nextRunAt">,
  now = Date.now(),
): boolean {
  if (!task || task.lastRunAt == null) return false;
  if (task.schedule?.kind === "once") return true;
  if (task.schedule?.kind === "interval") {
    return task.nextRunAt != null && now < task.nextRunAt;
  }
  return false;
}
