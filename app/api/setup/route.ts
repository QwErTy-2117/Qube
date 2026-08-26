export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Fire-and-forget both installs — don't block the response
    // This is called at app launch (AgentRuntimeProvider mount) so the user never has to
    // manually run scripts, and the agent doesn't need to know the backend.
    const { ensureCuaDriverInstalledBackground } = await import("@/lib/agent/computer/computer-mcp");
    const { ensureBrowserUseInstalledBackground } = await import("@/lib/agent/browser/browser-use-mcp");
    
    // Run in background, don't await
    try { ensureCuaDriverInstalledBackground(); } catch {}
    try { ensureBrowserUseInstalledBackground(); } catch {}

    return Response.json({ ok: true, message: "Setup triggered in background" });
  } catch (e) {
    // Never fail the launch — just log
    console.error("[setup] Failed to trigger background installs", e);
    return Response.json({ ok: true, warning: String(e) });
  }
}

export async function GET() {
  return POST();
}
