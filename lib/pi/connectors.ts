/**
 * Connector tools for Pi harness — Composio-backed external service tools.
 * Loaded with per-connector isolation: one failing connector never breaks
 * the whole chat. Returns {} when no connectors are connected.
 */

export async function loadConnectorTools(
  instanceId?: string
): Promise<{ tools: Record<string, any>; connected: string[] }> {
  try {
    const { getConnectorTools, getConnectedToolkits, DEFAULT_USER_ID } =
      await import("@/lib/connectors/composio");
    const uid = instanceId || DEFAULT_USER_ID;
    let connected: string[] = [];
    try {
      connected = await getConnectedToolkits(uid);
    } catch {}
    if (connected.length === 0) return { tools: {}, connected: [] };
    const timeoutMs = parseInt(process.env.PI_CONNECTOR_TIMEOUT_MS || "30000", 10);
    const load = (async () => getConnectorTools(uid))();
    const timeout = new Promise<Record<string, any>>((_, reject) =>
      setTimeout(() => reject(new Error(`Connector load timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    const tools = (await Promise.race([load, timeout])) as Record<string, any>;
    console.log(
      `[pi-connectors] Loaded ${Object.keys(tools).length} tools for ${connected.length} connected toolkit(s): ${connected.join(", ").slice(0, 200)}`
    );
    return { tools, connected };
  } catch (e: any) {
    console.warn("[pi-connectors] Load failed (non-fatal):", (e?.message || String(e)).slice(0, 300));
    return { tools: {}, connected: [] };
  }
}
