# Board Done Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recurring tasks land in Done after every run (all schedule shapes), and re-triggering a Done recurring task still works.

**Architecture:** Extract the board's ad-hoc `isDone` into a tested pure helper `isTaskDone` in `lib/scheduler/board-status.ts` that trusts persisted `nextRunAt`; point `SchedulingTab` at it and relax the re-trigger guard to one-shots only.

**Tech Stack:** TypeScript, `node:test` + `node:assert/strict` via `tsx`, React (`scheduling-tab.tsx`).

---

### Task 1: `isTaskDone` helper plus unit tests

**Files:**
- Create: `lib/scheduler/board-status.ts`
- Create: `tests/board-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isTaskDone } from "@/lib/scheduler/board-status";

const PERMS = { runCommands: false, destructiveCommands: false, externalFiles: false, webAccess: false };
const NOW = 1_800_000_000_000;

function base(over: Record<string, unknown> = {}) {
  return {
    id: "t",
    type: "scheduled",
    name: "T",
    instructions: "Do it.",
    schedule: { kind: "interval", intervalMinutes: 60 },
    enabled: true,
    permissions: PERMS,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    lastRunAt: null,
    nextRunAt: NOW + 3_600_000,
    ...over,
  } as never;
}

describe("isTaskDone", () => {
  it("is false before any run", () => {
    assert.equal(isTaskDone(base(), NOW), false);
  });

  it("marks once tasks done after a run", () => {
    const t = base({ schedule: { kind: "once", runAt: NOW + 1000 }, lastRunAt: NOW });
    assert.equal(isTaskDone(t, NOW), true);
  });

  it("marks interval tasks done inside the window", () => {
    const t = base({ lastRunAt: NOW - 1_000, nextRunAt: NOW + 3_599_000 });
    assert.equal(isTaskDone(t, NOW), true);
  });

  it("returns interval tasks to not-done after nextRunAt passes", () => {
    const t = base({ lastRunAt: NOW - 10_000_000, nextRunAt: NOW - 1_000 });
    assert.equal(isTaskDone(t, NOW), false);
  });

  it("marks wall-clock daily tasks done (no intervalMinutes)", () => {
    const t = base({
      schedule: { kind: "interval", hour: 6, minute: 0 },
      lastRunAt: NOW - 1_000,
      nextRunAt: NOW + 80_000_000,
    });
    assert.equal(isTaskDone(t, NOW), true);
  });

  it("keeps done after a manual re-run inside the period", () => {
    const t = base({ lastRunAt: NOW - 500, nextRunAt: NOW + 3_599_500 });
    assert.equal(isTaskDone(t, NOW), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/board-status.test.ts`
Expected: FAIL with "Cannot find module '@/lib/scheduler/board-status'" (or similar import error).

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/board-status.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add lib/scheduler/board-status.ts tests/board-status.test.ts
git commit -m "feat: board Done status trusts nextRunAt for all recurring shapes"
```

### Task 2: Point SchedulingTab at the helper, allow re-running Done recurring tasks

**Files:**
- Modify: `components/shared/scheduling-tab.tsx:39-48` (local `isDone` function)
- Modify: `components/shared/scheduling-tab.tsx:107-150` (columns `useMemo` + deps)
- Modify: `components/shared/scheduling-tab.tsx:152-173` (`triggerTask`)

- [ ] **Step 1: Delete the local `isDone` and import the helper**

Replace lines 39-48:

```ts
function isDone(task: ScheduledTask, now = Date.now()): boolean {
  if (task.lastRunAt == null) return false;
  if (task.schedule.kind === "once") return true;
  // Recurring task: once it has run in the current recurrence window it is
  // done for that period (a daily task that already ran today belongs in
  // Done until the next day starts).
  const intervalMinutes = task.schedule.intervalMinutes;
  if (!intervalMinutes || intervalMinutes <= 0) return false;
  return now < task.lastRunAt + intervalMinutes * 60_000;
}
```

with:

```ts
import { isTaskDone } from "@/lib/scheduler/board-status";
```

Add the import next to the existing kanban-board import (lines 16-22). The `ScheduledTask` interface above stays as-is (UI-local type).

- [ ] **Step 2: Replace `isDone(task, now)` with `isTaskDone(task, now)` in the bucketing loop and relax the re-trigger guard**

In the columns `useMemo` (line ~114), change `if (isDone(task, now)) {` to `if (isTaskDone(task, now)) {`. Both the UI-local interface and the store type satisfy the `Pick` signature structurally, so no cast is needed (`type: "heartbeat" | "scheduled"` accepts `"scheduled"`, `nextRunAt: number` accepts into `number | null`).

In `triggerTask` (line ~158), change:

```ts
if (!task || isDone(task)) return;
```

to:

```ts
if (!task) return;
// Finished one-shots are terminal; recurring tasks stay re-runnable and
// fresh timestamps keep them in Done.
if (task.schedule.kind === "once" && isTaskDone(task, Date.now())) return;
```

- [ ] **Step 3: Typecheck the touched file**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors mentioning scheduling-tab). If unrelated repo errors exist, confirm none name `scheduling-tab` or `board-status`.

- [ ] **Step 4: Run the board-status tests plus related suites**

Run: `npx tsx --test tests/board-status.test.ts tests/durable-scheduler.test.ts tests/agent-proactivity.test.ts`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add components/shared/scheduling-tab.tsx
git commit -m "fix: recurring runs land in Done; Done recurring tasks stay re-runnable"
```

## Self-review note (plan author)

Spec section 3 coverage: 3.1 (helper + rule), 3.2 (guard change), 3.3 (acceptance via tests + manual board check). No placeholders: all code inline. Types: `isTaskDone(task: Pick<ScheduledTask, ...>, now)` matches test, UI-local, and store call sites without casts.
