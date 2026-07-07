import { getTasks, updateTaskRunTime } from "./task-store";

let tickInterval: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startScheduler() {
  if (tickInterval) return;
  console.log("[scheduler] Starting scheduler (tick every 60s)");
  tick();
  tickInterval = setInterval(tick, 60_000);
}

export function stopScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const tasks = await getTasks();
    const now = Date.now();
    const dueTasks = tasks.filter(
      (t) => t.enabled && t.nextRunAt <= now,
    );

    if (dueTasks.length === 0) return;

    const { executeTask } = await import("./task-executor");

    for (const task of dueTasks) {
      console.log(
        `[scheduler] Running task: ${task.name} (${task.id})`,
      );
      const result = await executeTask(task);
      await updateTaskRunTime(task.id, result.status === "success");
      console.log(
        `[scheduler] Task ${task.id} completed: ${result.status} (${result.duration}ms)`,
      );
    }
  } catch (error) {
    console.error("[scheduler] Tick error:", error);
  } finally {
    running = false;
  }
}
