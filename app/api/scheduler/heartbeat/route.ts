import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTask } from "@/lib/scheduler/task-store";

export async function GET() {
  const task = await getTask("heartbeat");
  if (!task)
    return NextResponse.json(
      { error: "Heartbeat not found" },
      { status: 404 },
    );
  return NextResponse.json({ task });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const patch: any = {};
  if (body.instructions !== undefined)
    patch.instructions = body.instructions;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.intervalMinutes !== undefined) {
    patch.schedule = {
      kind: "interval",
      intervalMinutes: body.intervalMinutes,
    };
  }
  const task = await updateTask("heartbeat", patch);
  if (!task)
    return NextResponse.json(
      { error: "Heartbeat not found" },
      { status: 404 },
    );
  return NextResponse.json({ task });
}
