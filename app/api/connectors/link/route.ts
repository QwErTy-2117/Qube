import { NextRequest, NextResponse } from "next/server";
import { initiateConnection, resolveComposioUserId } from "@/lib/connectors/composio";
import { connectorCallbackUrl } from "@/lib/connectors/oauth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { connectorId, desktop } = await req.json();
    if (!connectorId) {
      return NextResponse.json({ error: "Missing connectorId" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const instanceId = resolveComposioUserId(searchParams.get("instanceId"));
    // The callback is opened by the system browser, so use the app's real
    // HTTP origin (including its dynamically assigned sidecar port).
    const callbackUrl = connectorCallbackUrl(
      req.url, req.headers.get("origin"), req.headers.get("referer"), desktop === true,
    );

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
