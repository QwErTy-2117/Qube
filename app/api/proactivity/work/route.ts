import { NextResponse } from "next/server";
import { addDays, format, startOfDay } from "date-fns";

import { getTasks } from "@/lib/scheduler/task-store";
import { isTaskDone } from "@/lib/scheduler/board-status";
import { taskOccurrencesInRange } from "@/lib/scheduler/calendar";
import { listActionableHeartbeatWork } from "@/lib/proactivity/heartbeat-work";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HomeTodoItem = {
  id: string;
  title: string;
  meta: string;
  done: boolean;
  kind: "heartbeat" | "reminder" | "today";
};

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

  try {
    const work = await listActionableHeartbeatWork(8);
    for (const entry of work) {
      const title =
        entry.topic?.trim() ||
        entry.summary?.trim().slice(0, 90) ||
        "Heartbeat work";
      items.push({
        id: `work:${entry.id}`,
        title,
        meta:
          entry.status === "blocked"
            ? "Blocked · next heartbeat"
            : "Next heartbeat",
        done: false,
        kind: "heartbeat",
      });
    }
  } catch {
    // The ledger is optional; the home card still shows tasks.
  }

  try {
    const tasks = await getTasks();
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = addDays(dayStart, 1);

    for (const task of tasks) {
      if (task.enabled === false || task.legacyScheduleRemoved === true) continue;
      // The heartbeat itself is not a task to display; it drives the work list.
      if (task.type === "heartbeat") continue;

      if (task.schedule.kind === "none") {
        items.push({
          id: `task:${task.id}`,
          title: task.name,
          meta: "Reminder",
          done: isTaskDone(task),
          kind: "reminder",
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
      const allDay = Boolean(task.allDay);
      items.push({
        id: `task:${task.id}`,
        title: task.name,
        meta: allDay ? "Today · All day" : `Today · ${format(when, "h:mm a")}`,
        done,
        kind: "today",
      });
    }
  } catch {
    // Task store unavailable: return whatever heartbeat work we have.
  }

  // Pending work first, completed items last, keeping source order stable.
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.done !== b.item.done) return a.item.done ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ item }) => item);

  return NextResponse.json(
    { items: ordered },
    { headers: { "Cache-Control": "no-store" } },
  );
}
