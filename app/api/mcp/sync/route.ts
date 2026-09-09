import { mcpStore, type McpServerConfig } from "@/lib/pi/mcp-store";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { servers } = body as { servers: McpServerConfig[] };
    if (!Array.isArray(servers)) {
      return Response.json({ ok: false, error: "servers must be an array" }, { status: 400 });
    }
    // Basic validation
    for (const s of servers) {
      if (!s.id || !s.name || !s.command || !Array.isArray(s.args)) {
        return Response.json({ ok: false, error: `Invalid server config: ${JSON.stringify(s).slice(0, 200)}` }, { status: 400 });
      }
      if (typeof s.env !== "object") (s as any).env = {};
    }
    mcpStore.sync(servers);
    console.log(`[mcp-sync] Synced ${servers.length} servers`);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const servers = mcpStore.getAll();
    return Response.json({ servers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
