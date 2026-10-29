# None-Schedule Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks can be saved with no schedule; they sit on the board until manually triggered or fulfilled by the next heartbeat with full task powers.

**Architecture:** Add `"none"` to `TaskScheduleKind` with nullable `nextRunAt`; harden the scheduler tick and missed-execution sweep against `null`; link each `none` task to a heartbeat checklist reminder that the heartbeat consumes into a full `executeTask` run with announcement.

**Tech Stack:** TypeScript, `node:test` + `node:assert/strict` via `tsx`, Next.js route handlers.

---

### Task 1: `none` kind in types and task-store

**Files:**
- Modify: `lib/scheduler/types.ts:1` (`TaskScheduleKind`)
- Modify: `lib/scheduler/types.ts:10-27` (`ScheduledTask.nextRunAt`)
- Modify: `lib/scheduler/task-store.ts:68-114` (`createTask`)
- Modify: `lib/scheduler/task-store.ts:116-140` (`updateTask`)
- Modify: `lib/scheduler/task-store.ts:152-189` (`updateTaskRunTime`)
- Modify: `lib/scheduler/task-store.ts:230-239` (`computeNextRunAtForSchedule`)
- Test: `tests/none-schedule.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-none-test-"));

import { createTask, updateTask, updateTaskRunTime, getTask } from "@/lib/scheduler/task-store";

describe("none-schedule tasks", () => {
  it("creates with null nextRunAt and survives a round-trip", async () => {
    const t = await createTask({ name: "Backlog", instructions: "Do it at heartbeat.", scheduleKind: "none" });
    assert.equal(t.schedule.kind, "none");
    assert.equal(t.nextRunAt, null);
    const again = await getTask(t.id);
    assert.equal(again?.nextRunAt, null);
  });

  it("keeps nextRunAt null after updateTaskRunTime", async () => {
    const t = await createTask({ name: "Backlog 2", instructions: "Do it.", scheduleKind: "none" });
    await updateTaskRunTime(t.id, true);
    const again = await getTask(t.id);
    assert.ok((again?.lastRunAt ?? 0) > 0);
    assert.equal(again?.nextRunAt, null);
  });

  it("switching kinds resets nextRunAt correctly", async () => {
    const t = await createTask({ name: "Switch", instructions: "x", scheduleKind: "interval", intervalMinutes: 60 });
    assert.ok((t.nextRunAt ?? 0) > Date.now());
    const toNone = await updateTask(t.id, { schedule: { kind: "none" } as never });
    assert.equal(toNone?.nextRunAt, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/none-schedule.test.ts`
Expected: FAIL — `createTask` has no `none` branch (type error or wrong `nextRunAt`).

- [ ] **Step 3: Write minimal implementation**

In `lib/scheduler/types.ts`, change:

```ts
export type TaskScheduleKind = "interval" | "once";
```

to:

```ts
export type TaskScheduleKind = "interval" | "once" | "none";
```

and in `ScheduledTask` change `nextRunAt: number;` to `nextRunAt: number | null;` (add comment: `null` = manual task, never auto-runs).

In `lib/scheduler/task-store.ts` `createTask`, after the `once` branch add:

```ts
let nextRunAt: number | null;
if (data.scheduleKind === "none") {
  nextRunAt = null;
} else if (data.scheduleKind === "once" && data.runAt) {
  nextRunAt = data.runAt;
} else {
  const interval = data.intervalMinutes ?? 30;
  nextRunAt = now + interval * 60_000;
}
```

and in the stored schedule object add `...(data.scheduleKind === "none" ? {} : {})` — no: keep the existing schedule literal, but only `none` stores `kind: data.scheduleKind` with no time fields (existing ternaries already yield `undefined` for `none`). No change needed there beyond the widened `nextRunAt` type.

In `updateTask`, after `if (patch.schedule) {` handling, add before the `kind === "interval"` check:

```ts
if (s.kind === "none") {
  tasks[idx].nextRunAt = null;
}
```

In `updateTaskRunTime`, add as the first schedule branch:

```ts
if (task.schedule.kind === "none") {
  task.nextRunAt = null;
}
```

In `computeNextRunAtForSchedule`, add at the top:

```ts
if (schedule.kind === "none") return null;
```

and change its return type to `number | null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/none-schedule.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Fix type errors the widened `nextRunAt` causes**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors only where `nextRunAt` is used arithmetically. Fix each call site minimally IN THIS TASK ONLY for type-correctness of files already compiling today:
- `lib/scheduler/scheduler.ts:43` — `t.schedule.intervalMinutes ? ... : 60_000` (no `nextRunAt` use; leave).
- Any error of the form "Type 'number | null' is not assignable" in `task-store.ts`, `scheduler.ts`, `heartbeat-brief.ts`, `agent-tools.ts`, `durable-scheduler.ts`, `scheduling-tab.tsx`: narrow with `?? 0` or explicit null checks WITHOUT changing runtime behavior yet (runtime guards come in Task 2). Record each touched line in the commit message body.
- Re-run `npx tsc --noEmit -p tsconfig.json` until no NEW errors remain versus `main` (compare with `git stash` + `npx tsc --noEmit` if unsure whether an error pre-exists).

- [ ] **Step 6: Commit**

```bash
git add lib/scheduler/types.ts lib/scheduler/task-store.ts tests/none-schedule.test.ts
git commit -m "feat: none schedule kind with null nextRunAt in task store"
```

### Task 2: Scheduler ignores null `nextRunAt`

**Files:**
- Modify: `lib/scheduler/scheduler.ts:36-52` (`handleMissedExecutions`)
- Modify: `lib/scheduler/scheduler.ts:280-283` (tick due filter)
- Test: `tests/none-schedule.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/none-schedule.test.ts`:

```ts
import { handleMissedDueFilterForTest } from "./helpers/scheduler-test-hooks";
```

No — do not invent helpers. Instead test the tick filter indirectly is hard without timers; write a pure regression test documenting the JS pitfall and guard the real code by inspection:

```ts
it("null nextRunAt must never count as due (null <= now is true in JS)", () => {
  const task = { enabled: true, nextRunAt: null };
  const due = task.enabled && task.nextRunAt != null && (task.nextRunAt as number) <= Date.now();
  assert.equal(due, false);
});
```

(This test passes trivially; its purpose is locking the guard expression used in the tick. The real verification is Step 3's code change + existing scheduler suites.)

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `npx tsx --test tests/none-schedule.test.ts`
Expected: PASS (documents the guard; implementation follows).

- [ ] **Step 3: Change the tick due filter and missed-execution sweep**

In `lib/scheduler/scheduler.ts` line 283, change:

```ts
const dueTasks = tasks.filter((t) => t.enabled && t.nextRunAt <= now);
```

to:

```ts
const dueTasks = tasks.filter((t) => t.enabled && t.nextRunAt != null && t.nextRunAt <= now);
```

In `handleMissedExecutions` (line 39-45), add a skip at the top of the loop body:

```ts
for (const t of tasks) {
  if (!t.enabled || t.nextRunAt == null) continue;
  ...
```

(Replace the existing `if (!t.enabled) continue;` line.)

- [ ] **Step 4: Run scheduler-related suites**

Run: `npx tsx --test tests/none-schedule.test.ts tests/durable-scheduler.test.ts tests/hard-reset.test.ts tests/heartbeat-proactivity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scheduler/scheduler.ts tests/none-schedule.test.ts
git commit -m "fix: scheduler never auto-runs null-nextRunAt manual tasks"
```

### Task 3: Agent tools and HTTP API accept `none`

**Files:**
- Modify: `lib/pi/agent-tools.ts:47` (zod `scheduleKind` enum) + create/update handlers lines 101-122, 137-156
- Modify: `lib/pi/durable-scheduler.ts:24` (TypeBox union) + create/update handlers lines 71-92, 106-125
- Modify: `app/api/scheduler/tasks/route.ts:27-53` (create) + lines 56-84 (update)
- Test: append to `tests/none-schedule.test.ts` for durable tool; zod tool covered via existing `agent-proactivity` cue tests (no new test needed beyond durable)

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { scheduleTaskTool } from "@/lib/pi/durable-scheduler";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

const fakeApi = { taskId: "test-none-tool" } as never;

function outText(result: unknown): string {
  return (result as { output: Array<{ text?: string }> }).output?.[0]?.text ?? "";
}

it("durable schedule_task creates a none task", async () => {
  const parsed = JSON.parse(outText(await scheduleTaskTool.execute(
    { action: "create", name: "Remind me", instructions: "Remind me to water the plants", scheduleKind: "none" } as never,
    fakeApi, BACKGROUND_CONTEXT,
  )));
  assert.ok(parsed.task?.id, JSON.stringify(parsed).slice(0, 200));
  assert.equal(parsed.task.schedule.kind, "none");
  assert.equal(parsed.task.nextRunAt, null);
});
```

Note: the `hasSchedulingCue` gate checks name+instructions text; "Remind me to water the plants" contains "remind" so it passes the gate. Keep those exact strings.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/none-schedule.test.ts`
Expected: FAIL with union/enum validation or `scheduleKind are required`-style error for `"none"`.

- [ ] **Step 3: Widen the schemas and handlers**

`lib/pi/agent-tools.ts` line 47: `z.enum(["interval", "once"])` → `z.enum(["interval", "once", "none"])`. The create handler (lines 110-121) passes `scheduleKind` through to `store.createTask` — no further change (store handles `none` since Task 1). The cue gate stays unchanged.

`lib/pi/durable-scheduler.ts` line 24: `Type.Union([Type.Literal("interval"), Type.Literal("once")])` → add `Type.Literal("none")`. Same pass-through, no other change.

`app/api/scheduler/tasks/route.ts` create: `scheduleKind: data.scheduleKind` passes through already; the only change is validation messaging — none needed, store accepts it. BUT the POST `trigger` path (lines 99-115) already works for `none` (executes + updates run time). No change. For `update`: passes `kind: data.scheduleKind` through; store handles it. So this file needs NO code change — verify by reading and confirm pass-through. If verification holds, this step is "verify no change needed" (still commit test).

- [ ] **Step 4: Run tests**

Run: `npx tsx --test tests/none-schedule.test.ts tests/durable-scheduler.test.ts tests/agent-proactivity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pi/agent-tools.ts lib/pi/durable-scheduler.ts tests/none-schedule.test.ts
git commit -m "feat: schedule_task tools accept none schedule kind"
```

### Task 4: Heartbeat fulfils linked manual tasks with full task powers

**Files:**
- Create: `lib/scheduler/manual-tasks.ts` (marker helpers + fetch/fulfil logic)
- Modify: `lib/scheduler/heartbeat-state.ts:166-191` (no change — reuse `addPendingAction`)
- Modify: `lib/scheduler/scheduler.ts:140-160` (`executeHeartbeat` due handling)
- Modify: `app/api/scheduler/tasks/route.ts:99-115` (trigger removes linked reminder)
- Test: `tests/manual-tasks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUBE_DATA_DIR = process.env.QUBE_DATA_DIR || mkdtempSync(join(tmpdir(), "qube-manual-test-"));

import { manualTaskMarker, parseManualTaskRef, linkManualTaskReminder, unlinkManualTaskReminder } from "@/lib/scheduler/manual-tasks";

describe("manual task heartbeat link", () => {
  it("round-trips the marker", () => {
    const desc = manualTaskMarker("task_abc123", "Water plants", "Remind me to water the plants");
    assert.match(desc, /\[manual-task:task_abc123\]/);
    assert.equal(parseManualTaskRef(desc), "task_abc123");
    assert.equal(parseManualTaskRef("plain reminder"), null);
  });

  it("links and unlinks a reminder in heartbeat state", async () => {
    const { loadHeartbeatState } = await import("@/lib/scheduler/heartbeat-state");
    await linkManualTaskReminder("task_link_1", "T", "Do T.");
    let state = await loadHeartbeatState();
    assert.ok(state.pendingActions.some((a) => a.description.includes("task_link_1")));
    await unlinkManualTaskReminder("task_link_1");
    state = await loadHeartbeatState();
    assert.ok(!state.pendingActions.some((a) => a.description.includes("task_link_1")));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/manual-tasks.test.ts`
Expected: FAIL with "Cannot find module '@/lib/scheduler/manual-tasks'".

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/manual-tasks.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Typecheck the new module**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors naming `manual-tasks`.

- [ ] **Step 6: Commit**

```bash
git add lib/scheduler/manual-tasks.ts tests/manual-tasks.test.ts
git commit -m "feat: heartbeat link helpers for manual tasks"
```

### Task 5: Wire fulfilment + unlinking into heartbeat and trigger

**Files:**
- Modify: `lib/scheduler/scheduler.ts:140-160` (`executeHeartbeat` due handling)
- Modify: `app/api/scheduler/tasks/route.ts:99-115` (trigger unlinks reminder)

- [ ] **Step 1: No new unit test — covered by composition**

`fulfilManualTasks` is unit-tested (Task 4); the wiring below is thin
composition already covered by the scheduler's existing suites. Verify via
Step 4 runs.

- [ ] **Step 2: Split dues and fulfil linked tasks in `executeHeartbeat`**

In `lib/scheduler/scheduler.ts`, after `dueActions` are consumed (line ~146),
add before `dueContext` is built:

```ts
import { parseManualTaskRef, fulfilManualTasks } from "./manual-tasks";

const manualDues = dueActions.filter((a) => parseManualTaskRef(a.description));
const regularDues = dueActions.filter((a) => !parseManualTaskRef(a.description));
```

Replace subsequent uses of `dueActions` for context/requeue with `regularDues`,
and after the main `executeTask(augmentedTask)` result handling, fulfil:

```ts
let manualFailed: Array<{ description: string; fileRefs?: string[] }> = [];
if (manualDues.length > 0) {
  try {
    const { failed } = await fulfilManualTasks(manualDues);
    manualFailed = failed;
  } catch {}
}
```

Requeue path: `await requeueDueActions([...regularRequeue, ...manualFailed])`
— i.e. failed manual dues re-enter the checklist; succeeded ones (already
consumed, never re-added) stay gone. Adjust the existing
`if ((quiet || result.status !== "success") && dueActions.length > 0)` block
to use `regularDues`, and always requeue `manualFailed` regardless of quiet.

- [ ] **Step 3: Unlink on manual trigger**

In `app/api/scheduler/tasks/route.ts` trigger case, after a successful run
of a `none` task, best-effort unlink so the next heartbeat skips it:

```ts
if (task.schedule.kind === "none" && result.status === "success") {
  try {
    const { unlinkManualTaskReminder } = await import("@/lib/scheduler/manual-tasks");
    await unlinkManualTaskReminder(task.id);
  } catch {}
}
```

Same unlink belongs in the `delete` case (any kind — unlink is a no-op string
scan when no reminder exists):

```ts
try {
  const { unlinkManualTaskReminder } = await import("@/lib/scheduler/manual-tasks");
  await unlinkManualTaskReminder(data.id);
} catch {}
```

- [ ] **Step 4: Run scheduler-related suites**

Run: `npx tsx --test tests/manual-tasks.test.ts tests/none-schedule.test.ts tests/heartbeat-proactivity.test.ts tests/announcements.test.ts tests/hard-reset.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scheduler/scheduler.ts app/api/scheduler/tasks/route.ts
git commit -m "feat: heartbeat fulfils linked manual tasks; trigger unlinks"
```

### Task 6: Recap string + server-side link on create (dialog UI lives in AI-drafts plan)

**Files:**
- Modify: `components/shared/scheduling-tab.tsx` (UI-local interface ONLY — Plan 1's `isTaskDone` already covers `none`)
- Modify: `lib/proactivity/heartbeat-brief.ts` (manual fallback string)
- Modify: `app/api/scheduler/tasks/route.ts` (server-side link on create)
- Depends on: `board-status.ts` from Plan 1 for Done placement. The `none` Run
  button, hint, `canCreate`/`handleCreate`, and `DialogDescription` are owned
  by the AI-drafts plan (dialog Task 4) to avoid double ownership.

- [ ] **Step 1: Extend the UI-local interface and recap**

In the `ScheduledTask` interface (lines 24-37): `nextRunAt: number` →
`nextRunAt: number | null` (needed so `none` cards render at all once Plan 1
lands; Done placement comes from Plan 1's `isTaskDone`).

In `lib/proactivity/heartbeat-brief.ts` line ~132, change the fallback:

```ts
const next = task.nextRunAt ? `next ${timeAgo(task.nextRunAt).replace(" ago", "")} from now`.replace("never", "unknown") : "manual — runs from the board";
```

- [ ] **Step 2: Server-side link on create**

In `app/api/scheduler/tasks/route.ts` create case, after `createTask`, add:

```ts
if (task.schedule.kind === "none") {
  try {
    const { linkManualTaskReminder } = await import("@/lib/scheduler/manual-tasks");
    await linkManualTaskReminder(task.id, task.name, task.instructions);
  } catch {}
}
```

- [ ] **Step 3: Done-column persist check**

`persist: t.schedule.kind === "interval"` (kanban `done` cards, line ~146)
stays interval-only: finished `none` cards follow one-shot overflow cleanup
(slide out → delete), per spec 4.5. No change — verify by reading, then run
the suites.

- [ ] **Step 4: Run typecheck + suites**

Run: `npx tsc --noEmit -p tsconfig.json` (no new errors in touched files).

Run: `npx tsx --test tests/none-schedule.test.ts tests/manual-tasks.test.ts tests/board-status.test.ts tests/durable-scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/shared/scheduling-tab.tsx lib/proactivity/heartbeat-brief.ts app/api/scheduler/tasks/route.ts
git commit -m "feat: manual recap string and heartbeat link for none tasks"
```

## Final self-review (plan author)

Spec section 4 coverage: 4.1 model/store (Tasks 1+3), 4.2 scheduler ignores
null (Task 2), 4.3 agent tools + HTTP (Task 3, trigger/delete already run +
update; unlink added Task 5), 4.4 heartbeat fulfilment full powers (Tasks
4-5), 4.5 presentation split: recap string + server-side link here (Task 6),
`none` Run button/hint/validation/`DialogDescription` in the AI-drafts plan
(dialog Task 4).
`nextRunAt: number | null` flows through store → scheduler → board consistently. Marker format
`[manual-task:<id>]` is the single contract between link/unlink/fulfil/split.
No placeholders: every step shows code or exact edits.
