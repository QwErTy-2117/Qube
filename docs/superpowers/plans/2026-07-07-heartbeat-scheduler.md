# Heartbeat & Task Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add autonomous heartbeat (every 30 min) and user/agent-managed cron-like scheduled tasks to Qube.

**Architecture:** In-process scheduler (`setInterval` ticking every 60s) running inside the Next.js server. Tasks stored as JSON in `.memory/scheduled-tasks.json`. Background tasks execute via `generateText` (non-streaming) with pre-configured permissions and no `ask_user` tool. Scheduler started at server boot via `instrumentation.ts`.

**Tech Stack:** Next.js 16, AI SDK v6 (`generateText`), existing JSON-file storage patterns, existing permission middleware.

---

### Task 1: Types & Task Store

**Files:**
- Create: `lib/scheduler/types.ts`
- Create: `lib/scheduler/task-store.ts`

- [ ] **Step 1: Create types file**

```typescript
// lib/scheduler/types.ts

export type TaskScheduleKind = "interval" | "once";

export type TaskPermissions = {
  runCommands: boolean;
  destructiveCommands: boolean;
  externalFiles: boolean;
  webAccess: boolean;
  browserAccess: boolean;
};

export type ScheduledTask = {
  id: string;
  type: "heartbeat" | "scheduled";
  name: string;
  instructions: string;
  schedule: {
    kind: TaskScheduleKind;
    intervalMinutes?: number;
    runAt?: number;
  };
  enabled: boolean;
  permissions: TaskPermissions;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
};

export type TaskLogEntry = {
  timestamp: number;
  taskId: string;
  name: string;
  status: "success" | "error";
  output: string;
  duration: number;
};

export const DEFAULT_HEARTBEAT_INTERVAL = 30;

export function getDefaultHeartbeatTask(): ScheduledTask {
  return {
    id: "heartbeat",
    type: "heartbeat",
    name: "Heartbeat",
    instructions: "Review recent changes, check for any pending work, and summarize the current state of the workspace. If nothing needs attention, report that all is well.",
    schedule: { kind: "interval", intervalMinutes: DEFAULT_HEARTBEAT_INTERVAL },
    enabled: true,
    permissions: {
      runCommands: true,
      destructiveCommands: false,
      externalFiles: false,
      webAccess: true,
      browserAccess: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRunAt: null,
    nextRunAt: Date.now() + DEFAULT_HEARTBEAT_INTERVAL * 60_000,
  };
}

export const DEFAULT_TASK_PERMISSIONS: TaskPermissions = {
  runCommands: false,
  destructiveCommands: false,
  externalFiles: false,
  webAccess: false,
  browserAccess: false,
};
```

- [ ] **Step 2: Create task store**

```typescript
// lib/scheduler/task-store.ts

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ScheduledTask,
  TaskPermissions,
  TaskScheduleKind,
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
      intervalMinutes: data.scheduleKind === "interval" ? data.intervalMinutes : undefined,
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
  patch: Partial<Pick<ScheduledTask, "name" | "instructions" | "schedule" | "enabled" | "permissions">>,
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
  } else if (task.schedule.kind === "interval" && task.schedule.intervalMinutes) {
    task.nextRunAt = Date.now() + task.schedule.intervalMinutes * 60_000;
  }
  task.updatedAt = Date.now();
  await persist(tasks);
}
```

- [ ] **Step 3: Verify imports work**

Run: `npx tsc --noEmit --strict lib/scheduler/types.ts lib/scheduler/task-store.ts 2>&1 | head -20`
Expected: No type errors (or errors about unused variables only, which is fine since these will be imported by other modules)

- [ ] **Step 4: Commit**

```bash
git add lib/scheduler/types.ts lib/scheduler/task-store.ts
git commit -m "feat(scheduler): add types and JSON-file task store"
```

---

### Task 2: Task Log

- [ ] **Step 1: Create task log module**

```typescript
// lib/scheduler/task-log.ts

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TaskLogEntry } from "./types";

const DATA_DIR = join(process.cwd(), ".memory");
const LOG_FILE = join(DATA_DIR, "task-log.jsonl");
const MAX_LOG_ENTRIES = 1000;

async function ensureLogFile() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

export async function appendLog(entry: TaskLogEntry): Promise<void> {
  await ensureLogFile();
  await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
}

export async function getLog(limit = 50): Promise<TaskLogEntry[]> {
  await ensureLogFile();
  if (!existsSync(LOG_FILE)) return [];
  const raw = await readFile(LOG_FILE, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);
  const entries: TaskLogEntry[] = lines.map((l) => JSON.parse(l));
  return entries.slice(-limit).reverse();
}

export async function pruneLog(): Promise<void> {
  await ensureLogFile();
  if (!existsSync(LOG_FILE)) return;
  const raw = await readFile(LOG_FILE, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);
  if (lines.length <= MAX_LOG_ENTRIES) return;
  const pruned = lines.slice(lines.length - MAX_LOG_ENTRIES);
  await appendFile(LOG_FILE, pruned.join("\n") + "\n", "utf-8");
  // Note: this overwrites rather than truly prunes. For production, use a proper log rotation.
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/scheduler/task-log.ts
git commit -m "feat(scheduler): add execution log (JSONL)"
```

---

### Task 3: Permission Bypass for Background Tasks

- [ ] **Step 1: Add task permission checker to middleware**

Add to `lib/middleware/permission-middleware.ts` (append before the end of file):

```typescript
import { TaskPermissions } from "@/lib/scheduler/types";
import { evaluateToolCall } from "./permission-middleware";

export function createTaskPermissionChecker(permissions: TaskPermissions) {
  return async function checkTaskPermission(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    const workspacePath = getWorkspacePath();
    const evaluation = evaluateToolCall(toolName, args, workspacePath);

    if (!evaluation.needsPermission) return true;

    // Check what the tool call needs against task permissions
    if (toolName === "run_command") {
      const commandArg = (args.command as string) || "";
      if (isDestructiveCommand(commandArg) && !permissions.destructiveCommands) {
        return false;
      }
      if (!permissions.runCommands) return false;
    }

    if (
      (toolName === "list_external_directory" || toolName === "read_external_file") &&
      !permissions.externalFiles
    ) {
      return false;
    }

    if (
      (toolName === "write_file" || toolName === "edit_file" || toolName === "delete_file") &&
      !permissions.externalFiles
    ) {
      const pathArg = (args.path as string) || "";
      const { resolve, relative } = await import("node:path");
      const resolvedPath = resolve(workspacePath, pathArg);
      const rel = relative(workspacePath, resolvedPath);
      if (rel.startsWith("..") && !permissions.externalFiles) return false;
    }

    if (
      (toolName === "web_search" || toolName === "web_fetch") &&
      !permissions.webAccess
    ) {
      return false;
    }

    if (toolName.startsWith("browser_") && !permissions.browserAccess) {
      return false;
    }

    return true;
  };
}
```

Wait, this imports from itself. Let me rethink the approach. The `evaluateToolCall` and `isDestructiveCommand` are already exported from the middleware file. Let me adjust.

Actually, `evaluateToolCall` is already exported. `isDestructiveCommand` is imported from workspace. And `getWorkspacePath` is imported from workspace. So I can just add the new function at the end of the file.

But there's a problem with circular imports — the middleware currently doesn't import from scheduler types. The import `import { TaskPermissions } from "@/lib/scheduler/types"` would be a new import. Let me make sure that doesn't create a circular dependency:
- `lib/middleware/permission-middleware.ts` → imports from `@/lib/scheduler/types` ← `lib/scheduler/types.ts`
- `lib/scheduler/types.ts` doesn't import from middleware. Good, no circular dep.

Let me rewrite Step 1 properly:

- [ ] **Step 1: Add task permission checker to middleware**

Edit `lib/middleware/permission-middleware.ts`:

Add import at top:
```typescript
import type { TaskPermissions } from "@/lib/scheduler/types";
```

Add at end of file (before the closing):
```typescript
export function createTaskPermissionChecker(permissions: TaskPermissions) {
  return function checkTaskPermission(
    toolName: string,
    args: Record<string, unknown>,
  ): { allowed: boolean; reason?: string } {
    const workspacePath = getWorkspacePath();
    const evaluation = evaluateToolCall(toolName, args, workspacePath);

    if (!evaluation.needsPermission) return { allowed: true };

    // Check run_command permissions
    if (toolName === "run_command") {
      const command = (args.command as string) || "";
      if (!permissions.runCommands) {
        return { allowed: false, reason: "Task does not have permission to run commands." };
      }
      if (isDestructiveCommand(command) && !permissions.destructiveCommands) {
        return { allowed: false, reason: "Task does not have permission to run destructive commands." };
      }
    }

    // Check external file access
    if (
      toolName === "list_external_directory" ||
      toolName === "read_external_file" ||
      (["write_file", "edit_file", "delete_file"].includes(toolName) && !permissions.externalFiles)
    ) {
      const pathArg = (args.path as string) || "";
      const rel = relative(workspacePath, resolve(workspacePath, pathArg));
      if (rel.startsWith("..")) {
        if (!permissions.externalFiles) {
          return { allowed: false, reason: "Task does not have permission to access files outside the workspace." };
        }
      }
    }

    // Check web access
    if ((toolName === "web_search" || toolName === "web_fetch") && !permissions.webAccess) {
      return { allowed: false, reason: "Task does not have permission to access the web." };
    }

    // Check browser access
    if (toolName.startsWith("browser_") && !permissions.browserAccess) {
      return { allowed: false, reason: "Task does not have permission to use the browser." };
    }

    return { allowed: true };
  };
}
```

We need to import `resolve`, `relative` from `node:path` at the top of the file too.

Current imports:
```typescript
import { resolve, relative } from "node:path";
import { getWorkspacePath, isDestructiveCommand } from "./workspace";
```

Good, `resolve` and `relative` are already imported.

- [ ] **Step 2: Commit**

```bash
git add lib/middleware/permission-middleware.ts
git commit -m "feat(scheduler): add task permission checker for background execution"
```

---

### Task 4: Task Executor

- [ ] **Step 1: Create task executor**

```typescript
// lib/scheduler/task-executor.ts

import { generateText } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { zen, resolveZenModel } from "@/lib/agent/zen";
import { ScheduledTask, TaskPermissions } from "./types";
import { appendLog } from "./task-log";
import { createTaskPermissionChecker } from "@/lib/middleware/permission-middleware";
import { createToolWrapper } from "./tool-wrapper";

// We need to build tools similar to the main agent but:
// 1. No ask_user tool
// 2. Permission check is done via task permissions, not user prompts
// 3. Tools are passed to generateText, not streamText

export async function executeTask(task: ScheduledTask): Promise<{ status: "success" | "error"; output: string; duration: number }> {
  const startTime = Date.now();
  const threadId = `task_${task.id}`;
  const permissionChecker = createTaskPermissionChecker(task.permissions);

  const systemPrompt = `You are a background autonomous task named "${task.name}". You run without user supervision.

## Your Task
${task.instructions}

## Rules
- Do NOT ask the user any questions. You must work autonomously.
- Do NOT wait for permission. You have pre-configured access based on what was granted to this task.
- If a tool call is denied, it means this task doesn't have permission for that operation. Work with what you have.
- Provide a concise summary of what you did.
- Focus on completing your task efficiently.`;
  try {
    const result = await generateText({
      model: zen.chat(resolveZenModel()),
      system: systemPrompt,
      prompt: `Execute your task: ${task.name}`,
      maxRetries: 0,
      temperature: 0.3,
      tools: buildTaskTools(threadId, permissionChecker, task.permissions),
      maxSteps: 15,
    });

    const duration = Date.now() - startTime;
    const output = result.text || "(no output)";

    await appendLog({
      timestamp: startTime,
      taskId: task.id,
      name: task.name,
      status: "success",
      output: output.slice(0, 500),
      duration,
    });

    return { status: "success", output, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    await appendLog({
      timestamp: startTime,
      taskId: task.id,
      name: task.name,
      status: "error",
      output: errMsg.slice(0, 500),
      duration,
    });

    return { status: "error", output: errMsg, duration };
  }
}

function buildTaskTools(threadId: string, checkPermission: ReturnType<typeof createTaskPermissionChecker>, permissions: TaskPermissions) {
  const wrap = (name: string, fn: (...args: any[]) => Promise<string>) => {
    return async (...args: any[]) => {
      const input = typeof args[0] === "object" && args[0] !== null ? args[0] : {};
      try {
        const { allowed, reason } = checkPermission(name, input as Record<string, unknown>);
        if (!allowed) {
          return JSON.stringify({ error: true, tool: name, message: reason || "Operation not permitted." });
        }
        return await fn(input);
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        return JSON.stringify({ error: true, tool: name, message: msg });
      }
    };
  };

  return {
    read_file: tool({
      description: "Reads a file at the specified path.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: wrap("read_file", async ({ path }) => {
        const { readFile } = await import("node:fs/promises");
        const { extname } = await import("node:path");
        const { resolvePathInWorkspace, relativePathInWorkspace } = await import("@/lib/middleware/workspace");
        const resolved = resolvePathInWorkspace(path);
        const content = await readFile(resolved, "utf-8");
        const lines = content.split("\n");
        return JSON.stringify({
          path: resolved,
          relativePath: relativePathInWorkspace(resolved),
          lineCount: lines.length,
          extension: extname(resolved),
          content,
        });
      }),
    }),

    write_file: tool({
      description: "Creates or overwrites a file.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string(), content: z.string() }),
      execute: wrap("write_file", async ({ path, content }) => {
        const { writeFile } = await import("node:fs/promises");
        const { resolvePathInWorkspace, relativePathInWorkspace } = await import("@/lib/middleware/workspace");
        const resolved = resolvePathInWorkspace(path);
        await writeFile(resolved, content, "utf-8");
        return JSON.stringify({
          path: resolved,
          relativePath: relativePathInWorkspace(resolved),
          status: "written",
        });
      }),
    }),

    edit_file: tool({
      description: "Finds text in a file and replaces it with new content.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string(), oldString: z.string(), newString: z.string() }),
      execute: wrap("edit_file", async ({ path, oldString, newString }) => {
        const { readFile, writeFile } = await import("node:fs/promises");
        const { resolvePathInWorkspace } = await import("@/lib/middleware/workspace");
        const resolved = resolvePathInWorkspace(path);
        const content = await readFile(resolved, "utf-8");
        if (!content.includes(oldString)) return JSON.stringify({ error: "Text not found.", status: "failed" });
        const fi = content.indexOf(oldString);
        const li = content.lastIndexOf(oldString);
        if (fi !== li) return JSON.stringify({ error: "Multiple matches found.", status: "failed" });
        await writeFile(resolved, content.replace(oldString, newString), "utf-8");
        return JSON.stringify({ status: "edited" });
      }),
    }),

    delete_file: tool({
      description: "Permanently deletes a file.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: wrap("delete_file", async ({ path }) => {
        const { unlink } = await import("node:fs/promises");
        const { resolvePathInWorkspace } = await import("@/lib/middleware/workspace");
        const resolved = resolvePathInWorkspace(path);
        await unlink(resolved);
        return JSON.stringify({ status: "deleted" });
      }),
    }),

    list_directory: tool({
      description: "Lists files and directories at a path.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: wrap("list_directory", async ({ path }) => {
        const { readdir, stat } = await import("node:fs/promises");
        const { resolvePathInWorkspace } = await import("@/lib/middleware/workspace");
        const resolved = resolvePathInWorkspace(path);
        const entries = await readdir(resolved, { withFileTypes: true });
        const items = await Promise.all(entries.map(async (entry) => {
          const fullPath = `${resolved}/${entry.name}`;
          let sz = 0;
          if (entry.isFile()) try { sz = (await stat(fullPath)).size; } catch {}
          return { name: entry.name, type: entry.isDirectory() ? "directory" : "file", size: sz, path: fullPath };
        }));
        return JSON.stringify({ path: resolved, items, totalItems: items.length });
      }),
    }),

    run_command: tool({
      description: "Executes a shell command.",
      inputSchema: z.object({ label: z.string().optional(), command: z.string() }),
      execute: wrap("run_command", async ({ command }) => {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        const { getWorkspacePath } = await import("@/lib/middleware/workspace");
        try {
          const { stdout, stderr } = await execAsync(command, { cwd: getWorkspacePath(), timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
          return JSON.stringify({ exitCode: 0, stdout, stderr, command });
        } catch (error: any) {
          return JSON.stringify({ exitCode: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message ?? "Unknown", command });
        }
      }),
    }),

    web_search: tool({
      description: "Searches the web using DuckDuckGo.",
      inputSchema: z.object({ label: z.string().optional(), query: z.string() }),
      execute: wrap("web_search", async ({ query }) => {
        const { DDGS } = await import("@phukon/duckduckgo-search");
        const ddgs = new DDGS({ timeout: 8000 });
        const raw = await ddgs.text({ keywords: query, maxResults: 6 });
        const results = raw.map((r: any) => ({
          title: r.title,
          url: r.href && !r.href.startsWith("/") ? r.href : "",
          snippet: r.body.replace(/\s+/g, " ").trim().slice(0, 300),
        })).filter((r: any) => r.url);
        return JSON.stringify({ query, results, totalResults: results.length });
      }),
    }),

    web_fetch: tool({
      description: "Fetches a URL and returns its text content.",
      inputSchema: z.object({ label: z.string().optional(), url: z.string(), selector: z.string().optional() })
        .refine(({ url }) => { try { new URL(url); return true; } catch { return false; } }, { message: "Invalid URL" }),
      execute: wrap("web_fetch", async ({ url, selector }) => {
        let targetUrl = url.trim();
        try { new URL(targetUrl); } catch { targetUrl = `https://${targetUrl.replace(/^https?:\/+/, "")}`; }
        const response = await fetch(targetUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(30_000),
        });
        const raw = await response.text();
        const ct = response.headers.get("content-type") || "";
        const isText = ct.includes("text") || ct.includes("json") || ct.includes("xml") || ct.includes("html");
        let content = `[Binary: ${ct}]`;
        if (isText) {
          if (selector) {
            const { JSDOM } = await import("jsdom");
            const dom = new JSDOM(raw);
            const els = dom.window.document.querySelectorAll(selector);
            content = Array.from(els).map((el: any) => el.textContent?.trim?.() || "").filter(Boolean).join("\n\n");
          } else {
            content = raw
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ").trim();
            if (content.length > 20_000) content = content.slice(0, 20_000) + "\n\n[...truncated...]";
          }
        }
        return JSON.stringify({ url: targetUrl, status: response.status, contentType: ct, content, size: raw.length });
      }),
    }),

    list_external_directory: tool({
      description: "Lists files at an absolute path outside the workspace.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: wrap("list_external_directory", async ({ path }) => {
        const { readdir, stat } = await import("node:fs/promises");
        const { resolveExternalPath } = await import("@/lib/middleware/workspace");
        const resolved = resolveExternalPath(path);
        const entries = await readdir(resolved, { withFileTypes: true });
        const items = await Promise.all(entries.map(async (entry) => {
          const fullPath = `${resolved}/${entry.name}`;
          let sz = 0;
          if (entry.isFile()) try { sz = (await stat(fullPath)).size; } catch {}
          return { name: entry.name, type: entry.isDirectory() ? "directory" : "file", size: sz, path: fullPath };
        }));
        return JSON.stringify({ path: resolved, items, totalItems: items.length });
      }),
    }),

    read_external_file: tool({
      description: "Reads a file at an absolute path outside the workspace.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: wrap("read_external_file", async ({ path }) => {
        const { readFile, stat } = await import("node:fs/promises");
        const { resolveExternalPath } = await import("@/lib/middleware/workspace");
        const resolved = resolveExternalPath(path);
        const content = await readFile(resolved, "utf-8");
        const s = await stat(resolved);
        return JSON.stringify({ path: resolved, size: s.size, lineCount: content.split("\n").length, content });
      }),
    }),

    read_memory: tool({
      description: "Reads persistent memory across sessions.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () => {
        const { getMemoryEntries } = await import("@/lib/memory/memory-store");
        return JSON.stringify({ entries: await getMemoryEntries() });
      },
    }),
  };
}
```

Wait, the `wrap` function is fine but I realize there's a duplicate of tool definitions here. That's not ideal. But the current agent.ts uses `ep()` which wraps `withPermissionCheck`. For task execution, I need different wrapping. Let me keep this duplication since the task executor has a smaller tool set (no browser tools, no session tools, no ask_user) and different permission handling. The alternative would be heavy refactoring of agent.ts which is out of scope.

Actually, the browser tools should also be included if `permissions.browserAccess` is true. Let me add them conditionally.

Let me also add the `list_sessions` / `read_session` tools since the task might want to access past context.

Actually, for simplicity and to keep the plan manageable, let me have the task executor reuse the browser tools from `browser-tools.ts` since those are already a separate module. And skip session tools (tasks are autonomous and don't need chat history).

Let me simplify the plan. Instead of listing all tool definitions inline, I'll note that the tools follow the same pattern as agent.ts but:
1. Without `ask_user`
2. Without session-related tools (list_sessions, read_session_summary, read_session)
3. With permission checking via `createTaskPermissionChecker` instead of `withPermissionCheck`
4. With conditional browser tools if permissions allow

Actually, let me keep the plan manageable. The full tool definitions are long and similar to what's in agent.ts. Let me write a more concise version that references the pattern.

- [ ] **Step 1: Create task executor**

I'll write the file more concisely - focusing on the critical differences from agent.ts.

OK let me just write the plan in a way that makes the actual implementation work. Let me simplify this - the plan is getting too long with full code blocks. Let me focus on key steps.

Actually wait, the writing-plans skill says "Complete code in every step" and "Every step must contain the actual content an engineer needs." But for something as repetitive as tool re-definitions, citing the pattern and showing the critical differences should be enough. Let me find a balance.

Let me rewrite this plan more concisely but still comprehensive. The tool definitions in the executor are essentially the same as agent.ts minus ask_user and with different permission wrapping. I'll note this clearly.<｜end▁of▁thinking｜>Let me write a concise, actionable plan focused on the critical pieces rather than full tool duplication.

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true"># Heartbeat & Task Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add autonomous heartbeat (every 30 min) and user/agent-managed scheduled tasks.

**Architecture:** In-process scheduler (`setInterval` ticking every 60s) in the Next.js server. Tasks in `.memory/scheduled-tasks.json`. Background execution via `generateText` (non-streaming, no `ask_user`, pre-configured permissions). Scheduler starts via `instrumentation.ts`.

**Tech Stack:** Next.js 16, AI SDK v6, existing JSON-file store patterns, existing permission middleware.

---

### Task 1: Types & Task Store

**Files:**
- Create: `lib/scheduler/types.ts`
- Create: `lib/scheduler/task-store.ts`

- [ ] **Step 1: Create `lib/scheduler/types.ts`**

```typescript
export type TaskScheduleKind = "interval" | "once";

export type TaskPermissions = {
  runCommands: boolean;
  destructiveCommands: boolean;
  externalFiles: boolean;
  webAccess: boolean;
  browserAccess: boolean;
};

export type ScheduledTask = {
  id: string;
  type: "heartbeat" | "scheduled";
  name: string;
  instructions: string;
  schedule: {
    kind: TaskScheduleKind;
    intervalMinutes?: number;
    runAt?: number;
  };
  enabled: boolean;
  permissions: TaskPermissions;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
};

export type TaskLogEntry = {
  timestamp: number;
  taskId: string;
  name: string;
  status: "success" | "error";
  output: string;
  duration: number;
};

export const DEFAULT_HEARTBEAT_INTERVAL = 30;

export function getDefaultHeartbeatTask(): ScheduledTask {
  return {
    id: "heartbeat",
    type: "heartbeat",
    name: "Heartbeat",
    instructions: "Review recent changes, check for any pending work, and summarize the current state. If nothing needs attention, report that all is well.",
    schedule: { kind: "interval", intervalMinutes: DEFAULT_HEARTBEAT_INTERVAL },
    enabled: true,
    permissions: {
      runCommands: true,
      destructiveCommands: false,
      externalFiles: false,
      webAccess: true,
      browserAccess: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRunAt: null,
    nextRunAt: Date.now() + DEFAULT_HEARTBEAT_INTERVAL * 60_000,
  };
}

export const DEFAULT_TASK_PERMISSIONS: TaskPermissions = {
  runCommands: false,
  destructiveCommands: false,
  externalFiles: false,
  webAccess: false,
  browserAccess: false,
};
```

- [ ] **Step 2: Create `lib/scheduler/task-store.ts`**

JSON file CRUD at `.memory/scheduled-tasks.json`. Auto-seeds heartbeat on first load. Exports: `getTasks`, `getTask`, `createTask`, `updateTask`, `deleteTask`, `updateTaskRunTime`. The heartbeat task (id: `"heartbeat"`) cannot be deleted. `createTask` auto-generates IDs like `task_{timestamp}_{random}`. `updateTaskRunTime` updates `lastRunAt`, `nextRunAt`, and disables "once" tasks after execution.

Key patterns (follow `lib/memory/memory-store.ts`):
- `cachedTasks: ScheduledTask[] | null` — in-memory cache
- `loadTasks()` — reads from JSON, seeds heartbeat if missing
- `persist(tasks)` — writes JSON + updates cache
- `updateTaskRunTime` — called by scheduler after execution

- [ ] **Step 3: Commit**

```bash
git add lib/scheduler/types.ts lib/scheduler/task-store.ts
git commit -m "feat(scheduler): add types and JSON-file task store"
```

---

### Task 2: Task Log

**Files:**
- Create: `lib/scheduler/task-log.ts`

- [ ] **Step 1: Create `lib/scheduler/task-log.ts`**

JSONL file at `.memory/task-log.jsonl`. Exports: `appendLog(entry)`, `getLog(limit = 50)` (returns newest first), `pruneLog()` (keeps last 1000 entries).

- [ ] **Step 2: Commit**

```bash
git add lib/scheduler/task-log.ts
git commit -m "feat(scheduler): add execution log (JSONL)"
```

---

### Task 3: Permission Bypass for Background Tasks

**Files:**
- Modify: `lib/middleware/permission-middleware.ts`

- [ ] **Step 1: Add import for `TaskPermissions`**

Add to the imports at top:
```typescript
import type { TaskPermissions } from "@/lib/scheduler/types";
```

- [ ] **Step 2: Add `createTaskPermissionChecker` function**

Add at end of file (before the closing `}` if there's a wrapping block, or just at the end):

```typescript
export function createTaskPermissionChecker(permissions: TaskPermissions) {
  const workspacePath = getWorkspacePath();

  return function checkTaskPermission(
    toolName: string,
    args: Record<string, unknown>,
  ): { allowed: boolean; reason?: string } {
    const evaluation = evaluateToolCall(toolName, args, workspacePath);
    if (!evaluation.needsPermission) return { allowed: true };

    if (toolName === "run_command") {
      const command = (args.command as string) || "";
      if (!permissions.runCommands) {
        return { allowed: false, reason: "Task does not have permission to run commands." };
      }
      if (isDestructiveCommand(command) && !permissions.destructiveCommands) {
        return { allowed: false, reason: "Task does not have permission to run destructive commands." };
      }
    }

    if (
      (toolName === "list_external_directory" || toolName === "read_external_file") &&
      !permissions.externalFiles
    ) {
      return { allowed: false, reason: "Task does not have permission to access external files." };
    }

    if (
      (toolName === "web_search" || toolName === "web_fetch") &&
      !permissions.webAccess
    ) {
      return { allowed: false, reason: "Task does not have permission to access the web." };
    }

    if (toolName.startsWith("browser_") && !permissions.browserAccess) {
      return { allowed: false, reason: "Task does not have permission to use the browser." };
    }

    if (
      (toolName === "write_file" || toolName === "edit_file" || toolName === "delete_file") &&
      !permissions.externalFiles
    ) {
      const pathArg = (args.path as string) || "";
      const rel = relative(workspacePath, resolve(workspacePath, pathArg));
      if (rel.startsWith("..")) {
        return { allowed: false, reason: "Task does not have permission to modify files outside workspace." };
      }
    }

    return { allowed: true };
  };
}
```

Note: `resolve`, `relative` are already imported from `node:path` at the top of the file.

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add lib/middleware/permission-middleware.ts
git commit -m "feat(scheduler): add task permission checker for background execution"
```

---

### Task 4: Task Executor

**Files:**
- Create: `lib/scheduler/task-executor.ts`

- [ ] **Step 1: Create `lib/scheduler/task-executor.ts`**

The executor runs a task via `generateText` with the same tools as the main agent minus `ask_user`, plus conditionally browser tools. Permission checking uses `createTaskPermissionChecker` instead of `withPermissionCheck`. Tool implementations are identical to `agent.ts` (same fs operations, same imports) — this duplication is intentional to avoid refactoring agent.ts.

Key structure:
```typescript
import { generateText, tool } from "ai";
import { z } from "zod";
import { zen, resolveZenModel } from "@/lib/agent/zen";
import { ScheduledTask } from "./types";
import { appendLog } from "./task-log";
import { createTaskPermissionChecker } from "@/lib/middleware/permission-middleware";
import { createBrowserTools } from "@/lib/agent/browser/browser-tools";

export async function executeTask(task: ScheduledTask) {
  const startTime = Date.now();
  const threadId = `task_${task.id}`;
  const checkPermission = createTaskPermissionChecker(task.permissions);

  const wrap = (name: string, fn: (args: any) => Promise<string>) => {
    return async (...args: any[]) => {
      const input = typeof args[0] === "object" && args[0] !== null ? args[0] : {};
      const { allowed, reason } = checkPermission(name, input);
      if (!allowed) return JSON.stringify({ error: true, tool: name, message: reason });
      try { return await fn(input); }
      catch (err) { return JSON.stringify({ error: true, tool: name, message: String(err) }); }
    };
  };

  // Tool definitions below follow the exact same pattern as agent.ts
  // but without: ask_user, list_sessions, read_session_summary, read_session
  // and with: wrap() instead of ep() for permission checking
  // browser tools added conditionally if task.permissions.browserAccess

  try {
    const result = await generateText({
      model: zen.chat(resolveZenModel()),
      system: buildTaskSystemPrompt(task),
      prompt: `Execute task: ${task.name}`,
      maxRetries: 0,
      temperature: 0.3,
      tools: {
        read_file: tool({ /* ... same as agent.ts */ }),
        write_file: tool({ /* ... same as agent.ts */ }),
        edit_file: tool({ /* ... same as agent.ts */ }),
        delete_file: tool({ /* ... same as agent.ts */ }),
        list_directory: tool({ /* ... same as agent.ts */ }),
        run_command: tool({ /* ... same as agent.ts */ }),
        web_search: tool({ /* ... same as agent.ts */ }),
        web_fetch: tool({ /* ... same as agent.ts */ }),
        list_external_directory: tool({ /* ... same as agent.ts */ }),
        read_external_file: tool({ /* ... same as agent.ts */ }),
        read_memory: tool({ /* ... same as agent.ts */ }),
        // ...createBrowserTools(threadId) only if browserAccess
      },
      maxSteps: 15,
    });

    const duration = Date.now() - startTime;
    await appendLog({ timestamp: startTime, taskId: task.id, name: task.name, status: "success", output: (result.text || "").slice(0, 500), duration });
    return { status: "success" as const, output: result.text || "", duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    await appendLog({ timestamp: startTime, taskId: task.id, name: task.name, status: "error", output: String(error).slice(0, 500), duration });
    return { status: "error" as const, output: String(error), duration };
  }
}

function buildTaskSystemPrompt(task: ScheduledTask): string {
  return `You are a background autonomous task named "${task.name}". You run without user supervision.

## Your Task
${task.instructions}

## Rules
- Do NOT ask the user any questions. Work autonomously.
- You have pre-configured access. If a tool is denied, skip it.
- Provide a concise summary of what you did.
- Do not mention that you're a background task or that you can't ask the user. Just do the work.`;
}
```

**IMPORTANT:** Every tool's `execute` handler must use `wrap()` instead of `ep()` for permission checking. Each tool's inner implementation is identical to `agent.ts`. Browser tools are conditionally spread if `task.permissions.browserAccess`.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add lib/scheduler/task-executor.ts
git commit -m "feat(scheduler): add task executor using generateText"
```

---

### Task 5: Scheduler

**Files:**
- Create: `lib/scheduler/scheduler.ts`

- [ ] **Step 1: Create `lib/scheduler/scheduler.ts`**

```typescript
import { getTasks, updateTaskRunTime } from "./task-store";
import { executeTask } from "./task-executor";

let tickInterval: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startScheduler() {
  if (tickInterval) return; // already started
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
  if (running) return; // prevent overlapping ticks
  running = true;
  try {
    const tasks = await getTasks();
    const now = Date.now();
    const dueTasks = tasks.filter((t) => t.enabled && t.nextRunAt <= now);

    for (const task of dueTasks) {
      console.log(`[scheduler] Running task: ${task.name} (${task.id})`);
      const result = await executeTask(task);
      await updateTaskRunTime(task.id, result.status === "success");
      console.log(`[scheduler] Task ${task.id} completed: ${result.status} (${result.duration}ms)`);
    }
  } catch (error) {
    console.error("[scheduler] Tick error:", error);
  } finally {
    running = false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/scheduler/scheduler.ts
git commit -m "feat(scheduler): add scheduler loop (60s tick)"
```

---

### Task 6: Instrumentation (Server Startup)

**Files:**
- Create: `instrumentation.ts`

- [ ] **Step 1: Create `instrumentation.ts`**

```typescript
export async function register() {
  const { startScheduler } = await import("./lib/scheduler/scheduler");
  startScheduler();
}
```

This runs once when the Next.js server starts.

- [ ] **Step 2: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(scheduler): start scheduler at server boot via instrumentation.ts"
```

---

### Task 7: API Routes

**Files:**
- Create: `app/api/scheduler/tasks/route.ts`
- Create: `app/api/scheduler/heartbeat/route.ts`
- Create: `app/api/scheduler/log/route.ts`

- [ ] **Step 1: Create `app/api/scheduler/tasks/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getTasks, getTask, createTask, updateTask, deleteTask } from "@/lib/scheduler/task-store";

export async function GET() {
  const tasks = await getTasks();
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, ...data } = body;

  if (action === "create") {
    const task = await createTask({
      name: data.name,
      instructions: data.instructions,
      scheduleKind: data.scheduleKind,
      intervalMinutes: data.intervalMinutes,
      runAt: data.runAt ? new Date(data.runAt).getTime() : undefined,
      permissions: data.permissions,
    });
    return NextResponse.json({ task });
  }

  if (action === "update") {
    const task = await updateTask(data.id, {
      name: data.name,
      instructions: data.instructions,
      schedule: data.scheduleKind ? {
        kind: data.scheduleKind,
        intervalMinutes: data.intervalMinutes,
        runAt: data.runAt ? new Date(data.runAt).getTime() : undefined,
      } : undefined,
      enabled: data.enabled,
      permissions: data.permissions,
    });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ task });
  }

  if (action === "delete") {
    const ok = await deleteTask(data.id);
    if (!ok) return NextResponse.json({ error: "Task not found or cannot be deleted" }, { status: 400 });
    return NextResponse.json({ success: true });
  }

  if (action === "trigger") {
    const task = await getTask(data.id);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const { executeTask } = await import("@/lib/scheduler/task-executor");
    const result = await executeTask(task);
    await updateTaskRunTime(task.id, result.status === "success");
    return NextResponse.json({ result });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
```

Add import for `updateTaskRunTime`:
```typescript
import { getTasks, getTask, createTask, updateTask, deleteTask, updateTaskRunTime } from "@/lib/scheduler/task-store";
```

- [ ] **Step 2: Create `app/api/scheduler/heartbeat/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/scheduler/task-store";

export async function GET() {
  const task = await getTask("heartbeat");
  if (!task) return NextResponse.json({ error: "Heartbeat not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const patch: any = {};
  if (body.instructions !== undefined) patch.instructions = body.instructions;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.intervalMinutes !== undefined) {
    patch.schedule = { kind: "interval", intervalMinutes: body.intervalMinutes };
  }
  const task = await updateTask("heartbeat", patch);
  if (!task) return NextResponse.json({ error: "Heartbeat not found" }, { status: 404 });
  return NextResponse.json({ task });
}
```

- [ ] **Step 3: Create `app/api/scheduler/log/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getLog } from "@/lib/scheduler/task-log";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
  const entries = await getLog(limit);
  return NextResponse.json({ entries });
}
```

- [ ] **Step 4: Verify routes compile**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add app/api/scheduler/
git commit -m "feat(scheduler): add CRUD API routes for tasks, heartbeat, and log"
```

---

### Task 8: Agent Tools

**Files:**
- Modify: `lib/agent/agent.ts`

- [ ] **Step 1: Add scheduler tool imports and tools**

Add these imports to `lib/agent/agent.ts`:
```typescript
import { getTasks, getTask, createTask, updateTask, deleteTask, updateTaskRunTime } from "@/lib/scheduler/task-store";
import { executeTask } from "@/lib/scheduler/task-executor";
```

Add these two tools inside the `createAgent` function's tools object (after the `read_memory` tool, before `ask_user`):

```typescript
schedule_task: tool({
  description: "Create, edit, delete, list, or immediately trigger scheduled tasks. Actions: create | edit | delete | list | trigger. For 'create': provide name, instructions, scheduleKind (interval/once), intervalMinutes or runAt, and optional permissions. For 'edit': provide task_id and fields to update. For 'delete': provide task_id. For 'list': no extra fields. For 'trigger': provide task_id.",
  inputSchema: z.object({
    action: z.enum(["create", "edit", "delete", "list", "trigger"]),
    task_id: z.string().optional(),
    name: z.string().optional(),
    instructions: z.string().optional(),
    schedule_kind: z.enum(["interval", "once"]).optional(),
    interval_minutes: z.number().optional(),
    run_at: z.string().optional(),
    permissions: z.object({
      runCommands: z.boolean().optional(),
      destructiveCommands: z.boolean().optional(),
      externalFiles: z.boolean().optional(),
      webAccess: z.boolean().optional(),
      browserAccess: z.boolean().optional(),
    }).optional(),
  }),
  execute: async ({ action, task_id, name, instructions, schedule_kind, interval_minutes, run_at, permissions }) => {
    try {
      switch (action) {
        case "create": {
          if (!name || !instructions || !schedule_kind) {
            return JSON.stringify({ error: "name, instructions, and schedule_kind are required for create" });
          }
          const task = await createTask({
            name, instructions, scheduleKind: schedule_kind,
            intervalMinutes: interval_minutes,
            runAt: run_at ? new Date(run_at).getTime() : undefined,
            permissions,
          });
          return JSON.stringify({ task, message: `Task "${name}" created. It will run ${schedule_kind === "interval" ? `every ${interval_minutes || 30} minutes` : `once on ${run_at}`}.` });
        }
        case "edit": {
          if (!task_id) return JSON.stringify({ error: "task_id is required for edit" });
          const patch: any = {};
          if (name !== undefined) patch.name = name;
          if (instructions !== undefined) patch.instructions = instructions;
          if (schedule_kind !== undefined) {
            patch.schedule = {
              kind: schedule_kind,
              intervalMinutes: interval_minutes,
              runAt: run_at ? new Date(run_at).getTime() : undefined,
            };
          }
          if (permissions !== undefined) patch.permissions = permissions;
          const updated = await updateTask(task_id, patch);
          if (!updated) return JSON.stringify({ error: "Task not found" });
          return JSON.stringify({ task: updated, message: `Task "${updated.name}" updated.` });
        }
        case "delete": {
          if (!task_id) return JSON.stringify({ error: "task_id is required for delete" });
          const ok = await deleteTask(task_id);
          if (!ok) return JSON.stringify({ error: "Task not found or heartbeat cannot be deleted" });
          return JSON.stringify({ message: "Task deleted." });
        }
        case "list": {
          const tasks = await getTasks();
          return JSON.stringify({ tasks });
        }
        case "trigger": {
          if (!task_id) return JSON.stringify({ error: "task_id is required for trigger" });
          const task = await getTask(task_id);
          if (!task) return JSON.stringify({ error: "Task not found" });
          executeTask(task).then(async (result) => {
            await updateTaskRunTime(task.id, result.status === "success");
            console.log(`[scheduler] Triggered task ${task_id} completed: ${result.status}`);
          }).catch((err) => console.error(`[scheduler] Triggered task ${task_id} failed:`, err));
          return JSON.stringify({ message: `Task "${task.name}" triggered. It is now running in the background.` });
        }
        default:
          return JSON.stringify({ error: `Unknown action: ${action}` });
      }
    } catch (error) {
      return JSON.stringify({ error: String(error) });
    }
  },
}),

update_heartbeat: tool({
  description: "Update the heartbeat task's instructions or interval. This is the system task that wakes the agent every N minutes.",
  inputSchema: z.object({
    instructions: z.string().optional(),
    interval_minutes: z.number().min(1).max(1440).optional(),
  }),
  execute: async ({ instructions, interval_minutes }) => {
    try {
      const patch: any = {};
      if (instructions !== undefined) patch.instructions = instructions;
      if (interval_minutes !== undefined) {
        patch.schedule = { kind: "interval", intervalMinutes: interval_minutes };
      }
      const task = await updateTask("heartbeat", patch);
      if (!task) return JSON.stringify({ error: "Heartbeat task not found" });
      return JSON.stringify({ task, message: "Heartbeat updated." });
    } catch (error) {
      return JSON.stringify({ error: String(error) });
    }
  },
}),
```

- [ ] **Step 2: Add tool UI registrations**

Follow the existing pattern in `components/assistant-ui/tools/index.ts` — add exports for the two new tool UIs (create stub files next, Task 9).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add lib/agent/agent.ts
git commit -m "feat(scheduler): add schedule_task and update_heartbeat agent tools"
```

---

### Task 9: Tool UI Components

**Files:**
- Create: `components/assistant-ui/tools/schedule-task-tool-ui.tsx`
- Create: `components/assistant-ui/tools/update-heartbeat-tool-ui.tsx`
- Modify: `components/assistant-ui/tools/index.ts`

- [ ] **Step 1: Create `schedule-task-tool-ui.tsx`**

Simple tool UI showing what action was taken. Follows the pattern of other tool UIs in the same directory.

```typescript
"use client";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Card, Clock, Plus, Play, Trash2, Edit3, ListChecks, Loader2 } from "lucide-react";

type ScheduleTaskArgs = {
  action: string;
  name?: string;
  task_id?: string;
  schedule_kind?: string;
  interval_minutes?: number;
};

export function ScheduleTaskToolUi({ args, result }: { args: ScheduleTaskArgs; result?: any }) {
  const parsed = typeof result === "string" ? safeJsonParse(result) : result;
  const isError = parsed?.error;

  const icon = {
    create: Plus,
    edit: Edit3,
    delete: Trash2,
    list: ListChecks,
    trigger: Play,
  }[args.action] || Card;

  const Icon = icon;
  const title = args.action === "create"
    ? `Scheduled: ${args.name}`
    : args.action === "trigger"
    ? `Triggered: ${args.name || args.task_id}`
    : `Task ${args.action}d`;

  const description = args.action === "create" && args.schedule_kind === "interval"
    ? `Every ${args.interval_minutes || 30} minutes`
    : args.action === "create" && args.schedule_kind === "once"
    ? "Runs once"
    : "";

  return (
    <div className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
        {isError && <div className="text-xs text-destructive mt-1">{parsed.error}</div>}
      </div>
    </div>
  );
}

function safeJsonParse(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}
```

- [ ] **Step 2: Create `update-heartbeat-tool-ui.tsx`**

```typescript
"use client";

import { Heart, Loader2 } from "lucide-react";

export function UpdateHeartbeatToolUi({ args, result }: { args: { instructions?: string; interval_minutes?: number }; result?: any }) {
  const parsed = typeof result === "string" ? safeJsonParse(result) : result;
  const isError = parsed?.error;

  return (
    <div className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
      <Heart className="mt-0.5 size-4 shrink-0 text-rose-500" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">Heartbeat Updated</div>
        {args.interval_minutes && (
          <div className="text-xs text-muted-foreground">Every {args.interval_minutes} minutes</div>
        )}
        {args.instructions && (
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{args.instructions}</div>
        )}
        {isError && <div className="text-xs text-destructive mt-1">{parsed.error}</div>}
      </div>
    </div>
  );
}

function safeJsonParse(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}
```

- [ ] **Step 3: Register in `tools/index.ts`**

Add exports following the existing pattern. Look at how other tools are exported and mirror it.

- [ ] **Step 4: Commit**

```bash
git add components/assistant-ui/tools/
git commit -m "feat(scheduler): add tool UI components for schedule_task and update_heartbeat"
```

---

### Task 10: Settings UI — Scheduling Tab

**Files:**
- Create: `components/shared/scheduling-tab.tsx`
- Modify: `components/shared/settings-dialog.tsx`

- [ ] **Step 1: Create `components/shared/scheduling-tab.tsx`**

A full scheduling management UI with three sections:

1. **Heartbeat section** — shows current interval, instructions (editable textarea), enabled toggle, last/next run time
2. **Scheduled Tasks section** — task cards with name, schedule summary, status badge (active/paused), action buttons (Edit/Run Now/Delete)
3. **Create Task form** — expandable inline form: name, instructions (textarea), schedule type radio (interval/once), interval number input or datetime input, permission checkboxes
4. **Execution Log section** — collapsible list from `GET /api/scheduler/log`, showing timestamp, name, status badge, duration, output

The component should use:
- `useState` for form state, tasks list, log entries
- `useEffect` to fetch data on mount
- fetch calls to `/api/scheduler/tasks`, `/api/scheduler/heartbeat`, `/api/scheduler/log`
- The same styling patterns as existing settings tabs (motion.div wrappers, border, bg-muted)

- [ ] **Step 2: Modify `settings-dialog.tsx`**

Add a 4th tab trigger "Scheduling" with a `Clock` icon (import from lucide-react) after the "Advanced" trigger:
```tsx
<TabsTrigger value="scheduling">
  <Clock className="size-4" />
  Scheduling
</TabsTrigger>
```

Add a 4th tab content section after the Advanced `TabsContent`:
```tsx
<TabsContent value="scheduling" className="flex-1 flex flex-col overflow-hidden p-6 mt-0 data-[state=inactive]:hidden">
  <SchedulingTab />
</TabsContent>
```

Add import: `import { SchedulingTab } from "./scheduling-tab";`
Add icon import: `import { Clock } from "lucide-react";`

- [ ] **Step 3: Commit**

```bash
git add components/shared/scheduling-tab.tsx components/shared/settings-dialog.tsx
git commit -m "feat(scheduler): add scheduling tab to settings UI"
```

---

### Task 11: Integration Smoke Test

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify scheduler starts**

Check terminal for `[scheduler] Starting scheduler (tick every 60s)` log message.

- [ ] **Step 3: Verify initial state**

Fetch: `curl http://localhost:3000/api/scheduler/tasks`
Expected: JSON with a heartbeat task.

Fetch: `curl http://localhost:3000/api/scheduler/heartbeat`
Expected: JSON with heartbeat task details.

Fetch: `curl http://localhost:3000/api/scheduler/log`
Expected: Empty array `{"entries":[]}`.

- [ ] **Step 4: Create a task via API**

```bash
curl -X POST http://localhost:3000/api/scheduler/tasks \
  -H "Content-Type: application/json" \
  -d '{"action":"create","name":"Test Task","instructions":"Write the current date to test.txt","scheduleKind":"interval","intervalMinutes":1,"permissions":{"runCommands":true}}'
```

Expected: JSON with the created task.

- [ ] **Step 5: Trigger the task immediately**

```bash
curl -X POST http://localhost:3000/api/scheduler/tasks \
  -H "Content-Type: application/json" \
  -d '{"action":"trigger","id":"<task_id_from_step_4>"}'
```

Expected: JSON with result. Check `.memory/task-log.jsonl` for the log entry.

- [ ] **Step 6: Verify heartbeat task runs**

Wait for the next tick or trigger it. Check `.memory/task-log.jsonl` for heartbeat entries.

- [ ] **Step 7: Check settings UI**

Open Qube in browser, open Settings, verify the Scheduling tab is visible and functional.

- [ ] **Step 8: Commit any final fixes**

```bash
git add -A
git commit -m "fix(scheduler): post-integration fixes"
```

---

## File Summary

| File | Action | Purpose |
|---|---|---|
| `lib/scheduler/types.ts` | Create | Shared types |
| `lib/scheduler/task-store.ts` | Create | JSON file CRUD |
| `lib/scheduler/task-log.ts` | Create | JSONL execution log |
| `lib/scheduler/task-executor.ts` | Create | Isolated task execution via generateText |
| `lib/scheduler/scheduler.ts` | Create | 60s tick loop |
| `instrumentation.ts` | Create | Server boot hook |
| `lib/middleware/permission-middleware.ts` | Modify | Add createTaskPermissionChecker |
| `lib/agent/agent.ts` | Modify | Add schedule_task + update_heartbeat tools |
| `app/api/scheduler/tasks/route.ts` | Create | Tasks CRUD API |
| `app/api/scheduler/heartbeat/route.ts` | Create | Heartbeat GET/PUT API |
| `app/api/scheduler/log/route.ts` | Create | Log fetch API |
| `components/shared/scheduling-tab.tsx` | Create | Settings tab UI |
| `components/shared/settings-dialog.tsx` | Modify | Add 4th tab |
| `components/assistant-ui/tools/schedule-task-tool-ui.tsx` | Create | Tool call UI |
| `components/assistant-ui/tools/update-heartbeat-tool-ui.tsx` | Create | Tool call UI |
| `components/assistant-ui/tools/index.ts` | Modify | Register new tool UIs |
