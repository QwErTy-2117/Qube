import { NextRequest, NextResponse } from "next/server";
import { getConnectedToolkits } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get("instanceId") || "qube-user";
    const connected = await getConnectedToolkits(instanceId);
    return NextResponse.json({ connected });
  } catch (e) {
    console.error("[connectors/status] Error:", e);
    return NextResponse.json({ connected: [], error: String(e) }, { status: 500 });
  }
}
