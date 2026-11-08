import { NextRequest, NextResponse } from "next/server";
import {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  updateTaskRunTime,
} from "@/lib/scheduler/task-store";

export async function GET() {
  try {
    const { ensureSchedulerStarted } = await import("@/lib/scheduler/init");
    ensureSchedulerStarted();
  } catch {}
  const tasks = await getTasks();
  // Repair reminder links for manual tasks created before this build (or
  // migrated back from the short-lived hidden-one-shot format).
  try {
    const { syncManualTaskReminders } = await import(
      "@/lib/scheduler/manual-tasks"
    );
    await syncManualTaskReminders();
  } catch {}
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, ...data } = body;

  try {
    switch (action) {
      case "create": {
        if (!data.name || !data.instructions || !data.scheduleKind) {
          return NextResponse.json(
            {
              error:
                "name, instructions, and scheduleKind are required for create",
            },
            { status: 400 },
          );
        }
        if (
          data.scheduleKind !== "once" &&
          data.scheduleKind !== "interval" &&
          data.scheduleKind !== "none"
        ) {
          return NextResponse.json(
            { error: "scheduleKind must be once, interval, or none" },
            { status: 400 },
          );
        }
        if (data.scheduleKind === "once" && !data.runAt) {
          return NextResponse.json(
            { error: "runAt is required for once tasks" },
            { status: 400 },
          );
        }
        const extras: string[] = [];
        if (data.doneCriteria) extras.push(`Done criteria: ${data.doneCriteria}`);
        if (data.condition) extras.push(`Only-report-if: ${data.condition}`);
        if (data.deliverablePath) extras.push(`Deliverable: ${data.deliverablePath}`);
        const instructions = extras.length > 0 ? `${data.instructions}\n\n${extras.join("\n")}` : data.instructions;
        const task = await createTask({
          name: data.name,
          instructions,
          scheduleKind: data.scheduleKind,
          intervalMinutes: data.intervalMinutes,
          runAt: data.runAt ? new Date(data.runAt).getTime() : undefined,
          hour: data.hour,
          minute: data.minute,
          weekdays: data.weekdays,
          monthDay: data.monthDay,
          permissions: data.permissions,
          color: data.color,
          location: data.location,
          durationMinutes: data.durationMinutes,
          allDay: data.allDay,
        });
        if (task.schedule.kind === "none") {
          try {
            const { linkManualTaskReminder } = await import(
              "@/lib/scheduler/manual-tasks"
            );
            await linkManualTaskReminder(task.id, task.name, task.instructions);
          } catch {}
        }
        return NextResponse.json({ task });
      }

      case "update": {
        const patch: any = {};
        if (data.name !== undefined) patch.name = data.name;
        if (data.instructions !== undefined)
          patch.instructions = data.instructions;
        if (data.color !== undefined) patch.color = data.color;
        if (data.location !== undefined) patch.location = data.location;
        if (data.durationMinutes !== undefined)
          patch.durationMinutes = data.durationMinutes;
        if (data.allDay !== undefined) patch.allDay = data.allDay;
        if (data.scheduleKind !== undefined) {
          if (
            data.scheduleKind !== "once" &&
            data.scheduleKind !== "interval" &&
            data.scheduleKind !== "none"
          ) {
            return NextResponse.json(
              { error: "scheduleKind must be once, interval, or none" },
              { status: 400 },
            );
          }
          patch.schedule = {
            kind: data.scheduleKind,
            intervalMinutes: data.intervalMinutes,
            runAt: data.runAt
              ? new Date(data.runAt).getTime()
              : undefined,
            hour: data.hour,
            minute: data.minute,
            weekdays: data.weekdays,
            monthDay: data.monthDay,
          };
        }
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        // Rescheduling a finished one-shot must re-arm it: the scheduler
        // disables one-shots after they run, so a new future runAt without an
        // explicit enabled flag is an intent to run again.
        if (
          data.enabled === undefined &&
          data.scheduleKind === "once" &&
          data.runAt &&
          new Date(data.runAt).getTime() > Date.now()
        ) {
          patch.enabled = true;
        }
        if (data.permissions !== undefined)
          patch.permissions = data.permissions;
        if (data.nextRunAt !== undefined) patch.nextRunAt = data.nextRunAt;
        const prevTask =
          data.scheduleKind !== undefined ||
          data.name !== undefined ||
          data.instructions !== undefined
            ? await getTask(data.id)
            : null;
        const task = await updateTask(data.id, patch);
        if (!task)
          return NextResponse.json(
            { error: "Task not found" },
            { status: 404 },
          );
        // Keep the heartbeat reminder attached to manual tasks, and detach it
        // when a task becomes scheduled or is renamed/edited.
        try {
          const { linkManualTaskReminder, unlinkManualTaskReminder } =
            await import("@/lib/scheduler/manual-tasks");
          if (task.schedule.kind === "none") {
            if (!task.enabled) {
              await unlinkManualTaskReminder(task.id);
            } else if (
              data.scheduleKind !== undefined ||
              data.name !== undefined ||
              data.instructions !== undefined ||
              data.enabled !== undefined
            ) {
              await linkManualTaskReminder(
                task.id,
                task.name,
                task.instructions,
              );
            }
          } else if (prevTask?.schedule.kind === "none") {
            await unlinkManualTaskReminder(task.id);
          }
        } catch {}
        return NextResponse.json({ task });
      }

      case "delete": {
        const ok = await deleteTask(data.id);
        if (!ok)
          return NextResponse.json(
            {
              error:
                "Task not found or heartbeat cannot be deleted",
            },
            { status: 400 },
          );
        try {
          const { unlinkManualTaskReminder } = await import(
            "@/lib/scheduler/manual-tasks"
          );
          await unlinkManualTaskReminder(data.id);
        } catch {}
        return NextResponse.json({ success: true });
      }

      case "trigger": {
        const task = await getTask(data.id);
        if (!task)
          return NextResponse.json(
            { error: "Task not found" },
            { status: 404 },
          );
        const { executeTask } = await import(
          "@/lib/scheduler/task-executor"
        );
        const result = await executeTask(task);
        await updateTaskRunTime(
          task.id,
          result.status === "success",
        );
        if (task.schedule.kind === "none" && result.status === "success") {
          try {
            const { unlinkManualTaskReminder } = await import(
              "@/lib/scheduler/manual-tasks"
            );
            await unlinkManualTaskReminder(task.id);
          } catch {}
        }
        return NextResponse.json({ result });
      }

      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 },
    );
  }
}
