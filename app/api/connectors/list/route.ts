import { NextRequest, NextResponse } from "next/server";
import { listConnectors, DEFAULT_USER_ID } from "@/lib/connectors/composio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const instanceId = searchParams.get("instanceId") || DEFAULT_USER_ID;
    const fresh = searchParams.get("fresh") === "1";
    const connectors = await listConnectors(instanceId, fresh ? { bypassCache: true } : undefined);
    const res = NextResponse.json({ connectors });
    // Connected flags are per-user and dynamic — never let the browser or
    // a proxy serve a stale list. Our server-side TTL cache is the cache.
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    console.error("[connectors/list] Error:", e);
    return NextResponse.json({ connectors: [], error: String(e) }, { status: 500 });
  }
}
