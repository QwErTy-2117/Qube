import { NextRequest, NextResponse } from "next/server";
import { getPendingConfirmations } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId") || "default";
    const pending = getPendingConfirmations(threadId);
    return NextResponse.json({ pending });
  } catch (e) {
    console.error("[connectors/pending] Error:", e);
    return NextResponse.json({ pending: [], error: String(e) }, { status: 500 });
  }
}
