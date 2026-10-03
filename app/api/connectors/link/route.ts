import { NextRequest, NextResponse } from "next/server";
import { initiateConnection, resolveComposioUserId } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { connectorId } = await req.json();
    if (!connectorId) {
      return NextResponse.json({ error: "Missing connectorId" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const instanceId = resolveComposioUserId(searchParams.get("instanceId"));
    // The OAuth provider redirects the user's BROWSER to this URL after auth,
    // so it must be the sidecar's real, reachable origin. The hardcoded
    // localhost:3000 fallback broke this on Windows (dev runs on 3010, prod
    // on a dynamic port): the browser landed on a dead page instead of the
    // "you can close this tab" screen. Prefer the request's origin, then the
    // referer, then the sidecar's own URL (always correct) — never a guess.
    const headers = req.headers;
    let callbackOrigin: string | null = headers.get("origin");
    if (!callbackOrigin) {
      const referer = headers.get("referer");
      if (referer) {
        try {
          callbackOrigin = new URL(referer).origin;
        } catch {}
      }
    }
    if (!callbackOrigin) {
      try {
        callbackOrigin = new URL(req.url).origin;
      } catch {}
    }
    const callbackUrl = `${callbackOrigin}/connectors/callback`;

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
