import { NextResponse } from "next/server";
import { getSessionUsage } from "@/lib/agent/session-usage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const threadId = String(url.searchParams.get("threadId") || "").trim();
    const model = String(url.searchParams.get("model") || "").trim() || null;
    const usage = await getSessionUsage(threadId, model);
    return NextResponse.json(usage, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
  }
}
