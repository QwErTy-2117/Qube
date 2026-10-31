export const dynamic = "force-dynamic";

export async function POST() {
  try {
    console.log(`[setup] Pi harness active — MCP + Qube Computer enabled`);
    // Prepare the persistent Qube Computer runtime (directories + session
    // state). The browser is launched lazily on first use, so an idle app
    // costs nothing.
    try {
      const { ensureComputer } = await import("@/lib/computer/session");
      ensureComputer();
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
