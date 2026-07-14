import { NextRequest, NextResponse } from "next/server";
import { getClient, DEFAULT_USER_ID } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { connectorId } = await req.json();
    if (!connectorId) {
      return NextResponse.json({ error: "Missing connectorId" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get("instanceId") || DEFAULT_USER_ID;
    const client = getClient();
    const accounts = await client.connectedAccounts.list({
      userIds: [instanceId],
    });

    const toDelete = (accounts.items || []).filter((a: any) =>
      a.toolkit?.slug === connectorId || a.app?.toLowerCase() === connectorId
    );

    await Promise.all(toDelete.map((a: any) =>
      client.connectedAccounts.delete(a.id)
    ));

    return NextResponse.json({ disconnected: connectorId, count: toDelete.length });
  } catch (e) {
    console.error("[connectors/disconnect] Error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
