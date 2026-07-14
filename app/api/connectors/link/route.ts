import { NextRequest, NextResponse } from "next/server";
import { initiateConnection, DEFAULT_USER_ID } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { connectorId } = await req.json();
    if (!connectorId) {
      return NextResponse.json({ error: "Missing connectorId" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get("instanceId") || DEFAULT_USER_ID;
    const origin = req.headers.get("origin") || "http://localhost:3000";
    const callbackUrl = `${origin}/connectors/callback`;

    const redirectUrl = await initiateConnection(connectorId, instanceId, callbackUrl);
    if (!redirectUrl) {
      return NextResponse.json(
        { error: `No auth config available for "${connectorId}". Set it up in the Composio dashboard first.` },
        { status: 404 },
      );
    }

    return NextResponse.json({ redirectUrl });
  } catch (e) {
    console.error("[connectors/link] Error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
