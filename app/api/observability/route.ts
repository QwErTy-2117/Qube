import { NextRequest } from "next/server";
import { queryObservability, getGlobalRecent, getStats } from "@/lib/agent/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/observability — read back the action/audit log (area 8: users
 * can see what the agent did). Query: threadId (omit for global), type
 * (repeatable, e.g. type=computer_action), limit (default 50, max 200),
 * stats=1 for counts instead of events.
 */
export async function GET(req: NextRequest) {
  try {
    // nextUrl exists on NextRequest; fall back to parsing req.url so the
    // handler also works when invoked with a plain Request (tests, harnesses).
    const nextUrl = (req as any).nextUrl ?? new URL((req as any).url);
    const q: URLSearchParams = nextUrl.searchParams;
    const threadId = q.get("threadId") || undefined;
    const types = q.getAll("type").filter(Boolean);
    const limit = Math.min(Math.max(parseInt(q.get("limit") || "50", 10) || 50, 1), 200);
    if (q.get("stats") === "1") {
      return Response.json({ stats: await getStats(threadId) });
    }
    if (threadId) {
      const events = await queryObservability(threadId, { type: types.length > 0 ? types : undefined, limit });
      return Response.json({ threadId, events });
    }
    const all = await getGlobalRecent(limit);
    const events = types.length > 0 ? all.filter((e) => types.includes(String(e?.type || ""))) : all;
    return Response.json({ threadId: null, events });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
