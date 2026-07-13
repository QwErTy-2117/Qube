import { NextResponse } from "next/server";
import { getConnectedToolkits } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const connected = await getConnectedToolkits("qube-user");
    return NextResponse.json({ connected });
  } catch (e) {
    console.error("[connectors/status] Error:", e);
    return NextResponse.json({ connected: [], error: String(e) }, { status: 500 });
  }
}
