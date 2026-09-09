export const dynamic = "force-dynamic";

export async function POST() {
  try {
    console.log(`[setup] Pi harness active — MCP enabled, browser workspace enabled`);
    // Warm up the shared headed browser in the background so the first
    // browser tool call doesn't pay launch latency. Never blocks setup.
    try {
      const { warmManagedChrome } = await import("@/lib/browser/managed-chrome");
      warmManagedChrome();
    } catch {}
    return Response.json({ ok: true, message: "Pi harness active — MCP enabled" });
  } catch (e) {
    console.error("[setup] Failed to trigger background installs", e);
    return Response.json({ ok: true, warning: String(e) });
  }
}

export async function GET() {
  return POST();
}
