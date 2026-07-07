import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ScheduledTask,
  type TaskPermissions,
  type TaskScheduleKind,
  DEFAULT_TASK_PERMISSIONS,
  getDefaultHeartbeatTask,
} from "./types";

const DATA_DIR = join(process.cwd(), ".memory");
const TASKS_FILE = join(DATA_DIR, "scheduled-tasks.json");

let cachedTasks: ScheduledTask[] | null = null;

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function loadRaw(): Promise<ScheduledTask[]> {
  await ensureDataDir();
  if (!existsSync(TASKS_FILE)) {
    const defaultTasks = [getDefaultHeartbeatTask()];
    await writeFile(TASKS_FILE, JSON.stringify(defaultTasks, null, 2), "utf-8");
    return defaultTasks;
  }
  const raw = await readFile(TASKS_FILE, "utf-8");
  return JSON.parse(raw);
}

export async function loadTasks(): Promise<ScheduledTask[]> {
  cachedTasks = await loadRaw();

  const { ensureSchedulerStarted } = await import("./init");
  ensureSchedulerStarted();

  return cachedTasks;
}

export async function getTasks(): Promise<ScheduledTask[]> {
  if (!cachedTasks) await loadTasks();
  return cachedTasks!;
}

async function persist(tasks: ScheduledTask[]) {
  cachedTasks = tasks;
  await writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
}

export async function getTask(id: string): Promise<ScheduledTask | null> {
  const tasks = await getTasks();
  return tasks.find((t) => t.id === id) ?? null;
}

export async function createTask(data: {
  name: string;
  instructions: string;
  scheduleKind: TaskScheduleKind;
  intervalMinutes?: number;
  runAt?: number;
  permissions?: Partial<TaskPermissions>;
}): Promise<ScheduledTask> {
  const tasks = await getTasks();
  const now = Date.now();
  let nextRunAt: number;
  if (data.scheduleKind === "once" && data.runAt) {
    nextRunAt = data.runAt;
  } else {
    const interval = data.intervalMinutes ?? 30;
    nextRunAt = now + interval * 60_000;
  }
  const task: ScheduledTask = {
    id: `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
    type: "scheduled",
    name: data.name,
    instructions: data.instructions,
    schedule: {
      kind: data.scheduleKind,
      intervalMinutes:
        data.scheduleKind === "interval" ? data.intervalMinutes : undefined,
      runAt: data.scheduleKind === "once" ? data.runAt : undefined,
    },
    enabled: true,
    permissions: { ...DEFAULT_TASK_PERMISSIONS, ...data.permissions },
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt,
  };
  tasks.push(task);
  await persist(tasks);
  return task;
}

export async function updateTask(
  id: string,
  patch: Partial<
    Pick<
      ScheduledTask,
      "name" | "instructions" | "schedule" | "enabled" | "permissions"
    >
  >,
): Promise<ScheduledTask | null> {
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...patch, updatedAt: Date.now() };
  if (patch.schedule) {
    const s = patch.schedule;
    if (s.kind === "interval" && s.intervalMinutes) {
      tasks[idx].nextRunAt = Date.now() + s.intervalMinutes * 60_000;
    }
    if (s.kind === "once" && s.runAt) {
      tasks[idx].nextRunAt = s.runAt;
    }
  }
  await persist(tasks);
  return tasks[idx];
}

export async function deleteTask(id: string): Promise<boolean> {
  if (id === "heartbeat") return false;
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  await persist(tasks);
  return true;
}

export async function updateTaskRunTime(id: string, success: boolean) {
  const tasks = await getTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.lastRunAt = Date.now();
  if (task.schedule.kind === "once") {
    task.enabled = false;
  } else if (
    task.schedule.kind === "interval" &&
    task.schedule.intervalMinutes
  ) {
    task.nextRunAt = Date.now() + task.schedule.intervalMinutes * 60_000;
  }
  task.updatedAt = Date.now();
  await persist(tasks);
}
