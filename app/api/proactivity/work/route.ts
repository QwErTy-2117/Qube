import { NextResponse } from "next/server";
import { addDays, startOfDay } from "date-fns";

import { getTasks } from "@/lib/scheduler/task-store";
import { isTaskDone } from "@/lib/scheduler/board-status";
import { taskOccurrencesInRange } from "@/lib/scheduler/calendar";
import { listActionableHeartbeatWork } from "@/lib/proactivity/heartbeat-work";
import { cleanTaskTitle } from "@/lib/todo/display";
import type { ScheduledTask } from "@/lib/scheduler/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HomeTodoItem = {
  id: string;
  title: string;
  done: boolean;
  kind: "heartbeat" | "reminder" | "today";
  /** Present when the row maps to an editable task. */
  taskId?: string;
};

const MANUAL_TASK_REF = /\[manual-task:([^\]]+)\]/i;

function manualTaskIdFromText(text: unknown): string | null {
  const match = MANUAL_TASK_REF.exec(String(text ?? ""));
  return match ? match[1] : null;
}

/** Ledger topics wrap the actual name in markers and a short description. */
function heartbeatWorkTitle(topic: unknown, summary: unknown): string {
  const raw =
    String(topic ?? "").trim() ||
    String(summary ?? "").trim() ||
    "Heartbeat work";
  const withoutChecklistLabel = raw.replace(/^due checklist item:\s*/i, "");
  const withoutMarker = withoutChecklistLabel.replace(MANUAL_TASK_REF, "");
  // Topics are stored as "<name> — <short description>" so the name alone
  // stays readable in the widget.
  const nameOnly = withoutMarker.split(/\s+—\s+/)[0] || withoutMarker;
  return cleanTaskTitle(nameOnly);
}

/**
 * Compact home checklist for the new-chat landing:
 * - work the next heartbeat will pick up (heartbeat work ledger),
 * - manual heartbeat reminders (schedule.kind === "none"),
 * - scheduled tasks with an occurrence today.
 *
 * Only display data; actions stay in the Tasks settings tab.
 */
export async function GET() {
  const items: HomeTodoItem[] = [];
  const seen = new Set<string>();
  let tasks: ScheduledTask[] = [];

  try {
    tasks = await getTasks();
  } catch {
    // The task store is optional; heartbeat work can still render.
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const push = (item: HomeTodoItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };

  try {
    const work = await listActionableHeartbeatWork(8);
    for (const entry of work) {
      const taskId =
        manualTaskIdFromText(entry.topic) ||
        manualTaskIdFromText(entry.summary) ||
        manualTaskIdFromText(entry.sourceRef);
      const linkedTask = taskId ? taskById.get(taskId) : undefined;

      if (linkedTask) {
        // A manual task can appear both in the ledger and in the task list;
        // show it once, using the task's clean name and real done state.
        push({
          id: `task:${linkedTask.id}`,
          title: cleanTaskTitle(linkedTask.name),
          done: isTaskDone(linkedTask),
          kind: "reminder",
          taskId: linkedTask.id,
        });
        continue;
      }

      push({
        id: `work:${entry.id}`,
        title: heartbeatWorkTitle(entry.topic, entry.summary),
        done: false,
        kind: "heartbeat",
      });
    }
  } catch {
    // The ledger is optional; the home card still shows tasks.
  }

  try {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = addDays(dayStart, 1);

    for (const task of tasks) {
      if (task.enabled === false || task.legacyScheduleRemoved === true) continue;
      // The heartbeat itself is not a task to display; it drives the work list.
      if (task.type === "heartbeat") continue;

      if (task.schedule.kind === "none") {
        push({
          id: `task:${task.id}`,
          title: cleanTaskTitle(task.name),
          done: isTaskDone(task),
          kind: "reminder",
          taskId: task.id,
        });
        continue;
      }

      let when: Date | null = null;
      if (task.schedule.kind === "once") {
        const runAt = task.schedule.runAt ?? task.nextRunAt;
        if (runAt && runAt >= dayStart.getTime() && runAt < dayEnd.getTime()) {
          when = new Date(runAt);
        }
      } else {
        const occurrences = taskOccurrencesInRange(task, {
          start: dayStart,
          end: dayEnd,
        });
        if (occurrences && occurrences.length > 0) {
          // Prefer the next occurrence still ahead today; fall back to the
          // last one so a finished cadence can still show crossed out.
          const upcoming = occurrences.find(
            (occurrence) => occurrence.end.getTime() >= now.getTime(),
          );
          when = (upcoming ?? occurrences[occurrences.length - 1]).start;
        }
      }

      if (!when) continue;
      const recurring = task.schedule.kind === "interval";
      const done = recurring
        ? task.lastRunAt != null &&
          (task.nextRunAt ?? 0) >= dayEnd.getTime()
        : isTaskDone(task);
      push({
        id: `task:${task.id}`,
        title: cleanTaskTitle(task.name),
        done,
        kind: "today",
        taskId: task.id,
      });
    }
  } catch {
    // Task store unavailable: return whatever heartbeat work we have.
  }

  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
