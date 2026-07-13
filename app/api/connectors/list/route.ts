import { NextResponse } from "next/server";
import { listConnectors } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const connectors = await listConnectors("qube-user");
    return NextResponse.json({ connectors });
  } catch (e) {
    console.error("[connectors/list] Error:", e);
    return NextResponse.json({ connectors: [], error: String(e) }, { status: 500 });
  }
}
