import { NextRequest, NextResponse } from "next/server";
import { getConnectedToolkits, resolveComposioUserId } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const instanceId = resolveComposioUserId(searchParams.get("instanceId"));
    const connectorId = searchParams.get("connectorId") || undefined;
    const connected = await getConnectedToolkits(instanceId, connectorId);
    return NextResponse.json({ connected });
  } catch (e) {
    console.error("[connectors/status] Error:", e);
    return NextResponse.json({ connected: [], error: String(e) }, { status: 500 });
  }
}
