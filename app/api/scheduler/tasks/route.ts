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
  const tasks = await getTasks();
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

      case "update": {
        const patch: any = {};
        if (data.name !== undefined) patch.name = data.name;
        if (data.instructions !== undefined)
          patch.instructions = data.instructions;
        if (data.scheduleKind !== undefined) {
          patch.schedule = {
            kind: data.scheduleKind,
            intervalMinutes: data.intervalMinutes,
            runAt: data.runAt
              ? new Date(data.runAt).getTime()
              : undefined,
          };
        }
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (data.permissions !== undefined)
          patch.permissions = data.permissions;
        const task = await updateTask(data.id, patch);
        if (!task)
          return NextResponse.json(
            { error: "Task not found" },
            { status: 404 },
          );
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
