# Design history: task board and tool titles

This folder keeps the design spec and implementation plans written on
2026-10-29 for four related changes to scheduled tasks and the chat's tool
activity cards. They were produced with an AI-assisted planning workflow
(the "superpowers" skills, which is where the folder name comes from) and are
kept as a record of **why** the code looks the way it does.

> **These are dated snapshots, not current documentation.** They describe the
> code as it was planned on 2026-10-29. File names, line numbers and UI
> details may have changed since. For how the features work today, see
> [Automations](../automations.md) and [Architecture](../architecture.md).
> The checkbox steps inside the plans were instructions for the implementer;
> unticked boxes do not mean the work is unfinished.

## The spec

[Design: task board Done semantics, None-schedule tasks, AI task drafts, tool group titles](./specs/2026-10-29-task-board-and-tool-titles-design.md)
— the problem statement and agreed design for all four changes.

## The plans and what exists in the code today

| Plan | Goal | Status in the current code |
| --- | --- | --- |
| [Board Done status](./plans/2026-10-29-board-done-status.md) | Recurring tasks show as Done after every run | Implemented: `isTaskDone` in `lib/scheduler/board-status.ts`, tested in `tests/board-status.test.ts`. It is now used by `app/api/proactivity/work/route.ts`; the Settings task board it was written for has since been rebuilt as a calendar plus to-do list. |
| [None-schedule tasks](./plans/2026-10-29-none-schedule-tasks.md) | Save a task with no schedule; the next heartbeat does it | Implemented: `"none"` in `TaskScheduleKind` (`lib/scheduler/types.ts`), tested in `tests/none-schedule.test.ts`. These are the "reminders" described in [Automations](../automations.md#reminders-non-scheduled-tasks). |
| [AI task drafts dialog](./plans/2026-10-29-ai-task-drafts-dialog.md) | Describe a task in plain language and get a full draft | Implemented: `lib/scheduler/task-draft.ts` and `POST /api/scheduler/draft`, tested in `tests/task-draft*.test.ts`. The `PromptPill` component from the plan (`components/shared/prompt-pill.tsx`) still exists but is no longer imported; the drafting input moved into the reworked Tasks tab. |
| [Tool group titles](./plans/2026-10-29-tool-group-titles.md) | Friendlier titles for finished groups of tool cards | Implemented: `finishedGroupTitle` in `components/assistant-ui/tools/group-title.ts`, used by `components/examples/base.tsx`, tested in `tests/group-title.test.ts`. |

Plans run in this order: board Done status → none-schedule tasks → AI task
drafts (depends on none-schedule) → tool group titles (independent).
