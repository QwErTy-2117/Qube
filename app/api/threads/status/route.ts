import { NextResponse } from "next/server";
import { getActivePiRuns } from "@/lib/pi/harness";
import { getPendingPermissions } from "@/lib/middleware/permission-middleware";
import { getPendingQuestions } from "@/lib/agent/tools/ask-user-tool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live per-session status for the sidebar. Everything is keyed by the
 * server-side thread id so the UI can put a spinner/dot on the right chat
 * without opening any of them.
 */
export async function GET() {
  const active = [...new Set(getActivePiRuns().map((run) => run.threadId))];
  const permissions = [
    ...new Set(
      getPendingPermissions()
        .map((request) => request.threadId)
        .filter(Boolean),
    ),
  ];
  const questions = [
    ...new Set(
      getPendingQuestions()
        .map((question) => question.threadId)
        .filter(Boolean),
    ),
  ];

  return NextResponse.json(
    { active, permissions, questions },
    { headers: { "Cache-Control": "no-store" } },
  );
}
