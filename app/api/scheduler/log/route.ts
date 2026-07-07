import { NextRequest, NextResponse } from "next/server";
import { getLog } from "@/lib/scheduler/task-log";

export async function GET(req: NextRequest) {
  const limit = parseInt(
    req.nextUrl.searchParams.get("limit") || "50",
    10,
  );
  const entries = await getLog(limit);
  return NextResponse.json({ entries });
}
