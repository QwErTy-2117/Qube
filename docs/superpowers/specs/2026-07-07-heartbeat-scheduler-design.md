# Heartbeat & Task Scheduling

**Date:** 2026-07-07
**Status:** Approved design

## Overview

Add heartbeat and task scheduling to Qube so the AI agent can run autonomously on a timer. The heartbeat is a special system task (every 30 min, non-deletable). Users and the agent can create/edit/delete additional scheduled tasks.

## Task Model

```
.memory/scheduled-tasks.json
```

```typescript
type ScheduledTask = {
  id: string;
  type: "heartbeat" | "scheduled";
  name: string;
  instructions: string;
  schedule: {
    kind: "interval" | "once";
    intervalMinutes?: number;
    runAt?: number;
  };
  enabled: boolean;
  permissions: {
    runCommands: boolean;
    destructiveCommands: boolean;
    externalFiles: boolean;
    webAccess: boolean;
    browserAccess: boolean;
  };
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number;
};
```

- `type: "heartbeat"` — created at system init, id is `"heartbeat"`, cannot be deleted or disabled entirely
- `type: "scheduled"` — user/agent created tasks
- `schedule.kind: "interval"` — repeats every `intervalMinutes`
- `schedule.kind: "once"` — fires once at `runAt` (Unix ms), then get disabled
- `permissions` — pre-approved capabilities for autonomous execution

## Architecture

### `lib/scheduler/task-store.ts`

JSON-file-backed task storage. Follows the same pattern as `lib/memory/memory-store.ts`.

```
loadTasks()        → ScheduledTask[]
saveTasks(tasks)   → void
createTask(data)   → ScheduledTask
updateTask(id, patch) → ScheduledTask
deleteTask(id)     → void
getTask(id)        → ScheduledTask | null
```

On init: if no file exists, seeds it with the default heartbeat task.

### `lib/scheduler/task-executor.ts`

Executes a single task in an isolated, non-streaming agent session.

```
executeTask(task: ScheduledTask): Promise<{ status: "success" | "error"; output: string; duration: number }>
```

- Uses `generateText` from the AI SDK (already imported in the codebase)
- Tool set: same base tools as the main agent, filtered by `task.permissions`, minus `ask_user`
- System prompt: task instructions + "You are a background task. Do NOT ask the user questions. Do NOT wait for approval. Work autonomously."
- Pre-configured permissions: the permission middleware checks `task.permissions` instead of prompting the user
- Returns the final text output

### `lib/scheduler/scheduler.ts`

The scheduler loop. Singleton started at server boot.

```
startScheduler()  — starts the tick loop
stopScheduler()   — stops the tick loop
```

- Ticks every 60 seconds via `setInterval`
- On each tick: reads tasks, identifies due (enabled + `nextRunAt <= now`), executes each via `task-executor.ts`
- After execution: updates `lastRunAt`, computes `nextRunAt` (for interval tasks) or sets `enabled = false` (for once tasks)
- Logs execution via `task-log.ts`
- Uses a lock to prevent overlapping ticks

### `lib/scheduler/task-log.ts`

Execution log stored in `.memory/task-log.jsonl` (JSON Lines format).

```
logEntry(taskId, status, output, duration)  → appends a line
getLog(limit = 50)                          → returns recent entries
```

Each line:
```json
{"timestamp": 1712345678000, "taskId": "heartbeat", "name": "Heartbeat", "status": "success", "output": "Summary of what happened", "duration": 45000}
```

## Agent Tools

Two new tools added to the main agent in `lib/agent/agent.ts`:

### `schedule_task`

Unified tool with action parameter (inspired by Hermes' cronjob tool):

```
schedule_task({
  action: "create" | "edit" | "delete" | "list" | "trigger",
  task_id?: string,
  name?: string,
  instructions?: string,
  schedule_kind?: "interval" | "once",
  interval_minutes?: number,
  run_at?: string,         // ISO date string for "once" tasks
  permissions?: {
    runCommands?: boolean;
    destructiveCommands?: boolean;
    externalFiles?: boolean;
    webAccess?: boolean;
    browserAccess?: boolean;
  }
})
```

- `create` — creates a new task with the given parameters
- `edit` — updates existing task (identified by `task_id`)
- `delete` — removes a task
- `list` — returns all tasks as JSON
- `trigger` — immediately runs the task

### `update_heartbeat`

```
update_heartbeat({
  instructions?: string,
  interval_minutes?: number
})
```

Updates heartbeat task properties.

## Permission Bypass for Background Tasks

In `lib/middleware/permission-middleware.ts`, add a new export:

```typescript
export function createTaskPermissionChecker(
  permissions: TaskPermissions
): (toolName: string, args: Record<string, unknown>) => Promise<boolean>
```

This replaces `withPermissionCheck` for background tasks. Instead of creating a prompt for the user, it evaluates if the tool call is allowed based on the task's pre-configured permissions. If not allowed, returns `"Operation not permitted by task permissions."`.

The `task-executor.ts` wraps tools with this checker instead of the user-prompting `ep()` wrapper.

## Settings UI: Scheduling Tab

New tab in `components/shared/settings-dialog.tsx`:

**Scheduling** tab (after Advanced):

1. **Heartbeat section:**
   - Status: enabled/disabled toggle
   - Interval: number input (minutes)
   - Instructions: textarea (editable)
   - Last run time, next run time

2. **Scheduled Tasks section:**
   - List of all tasks with name, schedule summary, status badge
   - Per-task: Edit / Run Now / Delete buttons
   - "Create Task" button → inline form:
     - Task name
     - Instructions (textarea)
     - Schedule type: radio (Interval / Once)
     - Interval: number input (if interval selected)
     - Run at: datetime picker (if once selected)
     - Permissions: checkboxes for each capability
   - Empty state when no tasks

3. **Execution Log section:**
   - Collapsible list of recent task runs
   - Timestamp, task name, status (success/error badge), duration, output preview

## API Routes

| Method | Route | Handler |
|---|---|---|
| `GET` | `/api/scheduler/tasks` | List all tasks |
| `POST` | `/api/scheduler/tasks` | Create task (body: task data) |
| `PATCH` | `/api/scheduler/tasks` | Update task (body: id + patch) |
| `DELETE` | `/api/scheduler/tasks` | Delete task (query: id) |
| `POST` | `/api/scheduler/tasks/trigger` | Trigger task (body: id) |
| `GET` | `/api/scheduler/heartbeat` | Get heartbeat config |
| `PUT` | `/api/scheduler/heartbeat` | Update heartbeat |
| `GET` | `/api/scheduler/log` | Get log entries (query: limit) |

## Server Startup

`instrumentation.ts` (at project root):

```typescript
export function register() {
  const { startScheduler } = require('./lib/scheduler/scheduler');
  startScheduler();
}
```

This runs once when the Next.js server starts. `startScheduler` is idempotent (checks for existing interval).

## File Layout

```
instrumentation.ts                          — Server startup (starts scheduler)
lib/scheduler/
  task-store.ts                            — JSON file CRUD
  task-executor.ts                         — Isolated task agent execution
  scheduler.ts                             — Tick loop
  task-log.ts                              — Execution log (JSONL)
  types.ts                                 — Shared types
app/api/scheduler/
  tasks/route.ts                           — Tasks CRUD API
  heartbeat/route.ts                       — Heartbeat API
  log/route.ts                             — Execution log API
components/shared/scheduling-tab.tsx       — New Scheduling tab component
components/assistant-ui/tools/
  schedule-task-tool-ui.tsx                — Tool call UI for schedule_task
  update-heartbeat-tool-ui.tsx             — Tool call UI for update_heartbeat
```

## Sequence Flow

```
User says "Check logs every hour"
  → Agent calls schedule_task({ action: "create", name: "Log check", ... })
  → task-store.ts saves to .memory/scheduled-tasks.json
  → Tool result shown in chat

Scheduler tick (every 60s)
  → Reads tasks from file
  → Finds due tasks
  → For each due task:
    → task-executor.ts runs generateText with task instructions
    → Permission checker uses task.preconfigured permissions
    → Output logged to .memory/task-log.jsonl
    → nextRunAt updated

Heartbeat tick (every 30 min by default)
  → Same flow, but task type is "heartbeat"
  → Agent gets heartbeat instructions as system prompt
  → "You are Qube's autonomous heartbeat. Check if anything needs attention..."
```

## Spec Self-Review

1. **Placeholders**: None. All sections are complete.
2. **Internal consistency**: Task model matches store, executor, scheduler, and API. Permission bypass is consistent with task permissions model. The scheduler tick timing (60s) doesn't conflict with any task interval (minimum would be heartbeat at 30min).
3. **Scope**: Focused on heartbeat + task scheduling. No scope creep.
4. **Ambiguity**: Task permissions default to all `false` for safety. Scheduler only runs when the server is up.
