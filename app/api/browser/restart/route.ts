import { restartManagedChrome } from "@/lib/browser/managed-chrome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kill the managed browser (if any) and relaunch it. The side panel
 * reattaches automatically; MCP picks up the fresh endpoint on the
 * next tool call. Never throws — always reports status.
 */
export async function POST() {
  try {
    const browser = await restartManagedChrome();
    return Response.json({ ok: true, browser });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
