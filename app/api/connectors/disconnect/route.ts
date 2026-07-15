import { NextRequest, NextResponse } from "next/server";
import { getClient, DEFAULT_USER_ID, COMPOSIO_TOOLKIT_MAP } from "@/lib/connectors/composio";

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

    const toolkits = COMPOSIO_TOOLKIT_MAP[connectorId] || [connectorId];
    const userIds = toolkits.map((slug: string) => `${instanceId}-${slug}`);

    const accounts = await client.connectedAccounts.list({
      userIds,
      limit: 100,
    });

    await Promise.all((accounts.items || []).map((a: any) =>
      client.connectedAccounts.delete(a.id)
    ));

    return NextResponse.json({ disconnected: connectorId, count: (accounts.items || []).length });
  } catch (e) {
    console.error("[connectors/disconnect] Error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
