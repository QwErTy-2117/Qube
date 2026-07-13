import { NextRequest, NextResponse } from "next/server";
import { initiateConnection } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { connectorId } = await req.json();
    if (!connectorId) {
      return NextResponse.json({ error: "Missing connectorId" }, { status: 400 });
    }

    const origin = req.headers.get("origin") || "http://localhost:3000";
    const callbackUrl = `${origin}/connectors/callback`;

    const redirectUrl = await initiateConnection(connectorId, "qube-user", callbackUrl);
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
