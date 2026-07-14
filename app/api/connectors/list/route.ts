import { NextRequest, NextResponse } from "next/server";
import { listConnectors } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get("instanceId") || "qube-user";
    const connectors = await listConnectors(instanceId);
    return NextResponse.json({ connectors });
  } catch (e) {
    console.error("[connectors/list] Error:", e);
    return NextResponse.json({ connectors: [], error: String(e) }, { status: 500 });
  }
}
