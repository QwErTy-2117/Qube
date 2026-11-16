import { NextResponse } from "next/server";
import { getActivePiRuns } from "@/lib/pi/harness";
import { getPendingPermissions } from "@/lib/middleware/permission-middleware";
import { getPendingQuestions } from "@/lib/agent/tools/ask-user-tool";
import { listRecentRunOutcomes } from "@/lib/agent/execution-ledger";

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

  // Recent chat outcomes for the top notifications. Five minutes is enough
  // for a poll (2s) and for a hidden tab to come back without replaying old
  // history; the client additionally ignores outcomes from before mount.
  const outcomes = await listRecentRunOutcomes({
    sinceMs: Date.now() - 5 * 60_000,
    limit: 50,
  });
  const event = (o: (typeof outcomes)[number]) => ({ threadId: o.threadId, at: o.at });

  return NextResponse.json(
    {
      active,
      permissions,
      questions,
      completed: outcomes.filter((o) => o.status === "completed").map(event),
      failed: outcomes.filter((o) => o.status === "failed").map(event),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
