# Task Tab Redesign (ex-Scheduling) — Design Spec

Date: 2026-10-08
Status: approved for planning
Scope: frontend-only, read-only transformation of Scheduling UI into Tasks UI.

## 1. Goal

Turn Settings → Scheduling into Settings → Tasks:
- tick-list tab icon + label (no clock),
- read-only rounded-rectangle task list,
- top recurring group without status circles,
- middle once-tasks with left done indicator,
- bottom existing Execution Log unchanged,
- remove Create Task entry point.

No backend change. Agent/chat creation path unchanged.

## 2. Current state

- `components/shared/settings-dialog.tsx`: `TabsTrigger value="scheduling"` with `Clock` icon + "Scheduling".
- `components/shared/scheduling-tab.tsx` (`SchedulingTab`):
  - top: Execution Log section (header + count + View Log button → log list dialog → log detail dialog),
  - middle: Scheduled Tasks section with Create Task button, `TaskFormDialog`, `ScheduleDialog`, `Calendar`, `RecurringSchedule`,
  - rows: enable `SwitchToggle` left, name + instructions + schedule meta, Play / Edit / Delete buttons right,
  - data: `GET /api/scheduler/tasks`, `GET /api/scheduler/log`; actions create/update/delete/trigger/toggle.
- `ScheduledTask`: `schedule.kind: interval | once`, `lastRunAt: number | null`, `nextRunAt`, `enabled`.

## 3. Design (Option A — minimal restyle, selected)

### 3.1 Tab chrome

- File: `components/shared/settings-dialog.tsx`
- Replace `Clock` import usage in scheduling trigger with `ListChecks` from `lucide-react`.
- Label: `Scheduling` → `Tasks`. Keep `value="scheduling"` to avoid breaking `tabValue` state / deep links.
- No other tab changes.

### 3.2 Tasks layout (read-only)

File: `components/shared/scheduling-tab.tsx`, `SchedulingTab` render order top→bottom:

1. Recurring section (top)
   - Header: `Recurring` + count badge (same pill style as log count).
   - Rows: existing rounded style `px-4 py-3 rounded-xl border border-border/60 bg-muted/10`, no circle, no switch, no action buttons.
   - Content per row: title (`text-sm font-semibold`), description = `instructions` (`text-xs muted line-clamp-2`), meta line (`text-[11px] muted/60`): human schedule + `Next: {formatDate(nextRunAt)}` + `Last: {formatDate(lastRunAt)}`.
   - Filter: `schedule.kind === "interval"`.
   - Empty state: muted bordered box, no CTA.

2. Divider: `<hr>` / `border-t border-border/60`.

3. Once-tasks section (middle)
   - Header: `Tasks` + count badge.
   - Rows: same rounded style. Left status circle (indicator only, `aria-hidden`, no onClick):
     - done (`lastRunAt != null`): 20px filled emerald circle with white check (`Check` icon, `size-3`).
     - pending: 20px outline circle (`border-border`).
   - Content: same title/description/meta pattern. Meta for once: `Once on {formatDate(runAt)}` + `Ran: {formatDate(lastRunAt)}` or `Next: {formatDate(nextRunAt)}`.
   - Filter: `schedule.kind === "once"`.
   - Done rule: `ticked = task.schedule.kind === "once" && task.lastRunAt != null`. No toggle, no mutation.

4. Divider.

5. Execution Log section (bottom, unchanged behavior)
   - Move existing block verbatim to bottom: header + count + View Log button, log list `Dialog`, log detail `Dialog`, helpers `formatDate`, `cleanLogOutput`, `logOneLiner`, `LogMarkdown`, `EchoRing` usage.
   - No inline rewrite.

### 3.3 Removals

- Remove UI: Create Task button, `SectionHeader` action, enable `SwitchToggle` in rows, Play/Edit/Delete buttons, delete-confirm dialog, `TaskFormDialog`, `ScheduleDialog`, `Calendar`, `RecurringSchedule`, `TaskFormDialog` state (`creating`, `editingTaskId`, `deleteConfirmId`).
- Remove handlers: `handleCreateTask`, `handleUpdateTask`, `handleDeleteTask`, `handleTriggerTask`, `handleToggleTask`. Keep `fetchData` (GET only).
- Remove now-unused imports: `Button` (except View Log), `Switch`, `Plus`, `Play`, `Trash2`, `Edit3`, `Loader2` (keep for loading), `CheckIcon`/`XIcon` (except done-circle `Check`), `Tabs` etc. if unused. Keep `cn`, `motion`, `ReactMarkdown` for log.
- If `SwitchToggle`, `SectionHeader`, schedule helpers become unused, delete them. Keep `scheduleSummary` only if still used for meta; else inline meta formatters.
- Backend routes (`/api/scheduler/tasks`, `/api/scheduler/log`) untouched.

### 3.4 Data flow

- `fetchData`: GET tasks + log in parallel, same as today. No POST from this tab.
- Derived: `recurringTasks = tasks.filter(t => t.type === "scheduled" && t.schedule.kind === "interval")`, `onceTasks = tasks.filter(t => t.type === "scheduled" && t.schedule.kind === "once")`.
- Loading state unchanged (spinner). Empty states per section, no CTA.

### 3.5 Error handling

- Fetch failure: existing silent catch + `setLoading(false)`; sections render empty states. No new error paths (no mutations, so no save/delete failures).
- Log dialogs: unchanged.

### 3.6 Testing

- Manual: Settings → Tasks shows ListChecks icon; recurring on top without circles; once-tasks with correct ticked state (seed one once-task with `lastRunAt=null` and one with timestamp); no Create/Edit/Delete/switch affordances; View Log opens from bottom and detail popup works; `tsc --noEmit` + existing scheduler tests pass.
- No new unit tests (display-only change).

## 4. Alternatives rejected

- B: separate `done` boolean + API migration — overkill; `once + lastRunAt` already encodes done.
- C: inline full log list at bottom — longer page, scroll conflicts; user asked to keep existing log.

## 5. Files touched

- `components/shared/settings-dialog.tsx` (icon + label)
- `components/shared/scheduling-tab.tsx` (reorder, read-only rows, removals)
- `docs/superpowers/specs/2026-10-08-task-tab-design.md` (this file)

No API, store, or schema changes.
