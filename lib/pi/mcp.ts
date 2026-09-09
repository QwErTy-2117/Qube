/**
 * Pi MCP integration — custom servers from advanced settings.
 * Each server is a stdio MCP transport (command + args + env).
 * Loads server configs from mcpStore (persisted via /api/mcp/sync) and
 * optionally from per-request override.
 */

import { mcpStore, type McpServerConfig } from "./mcp-store";
import { getBuiltInMcpServers, BROWSER_MCP_SERVER_ID } from "./browser-mcp";

type MCPClient = Awaited<ReturnType<typeof import("@ai-sdk/mcp").createMCPClient>>;

// How long to wait for a single MCP server (spawn + handshake + tools/list).
// npx -y downloads on first run can take a while; beyond this we fail that one
// server only (never the whole chat) so the user gets a clear warning.
const MCP_STARTUP_TIMEOUT_MS = parseInt(process.env.PI_MCP_TIMEOUT_MS || "45000", 10);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/** Quick liveness check of a --cdp-endpoint arg set (2s budget). */
async function probeCdpEndpoint(args: string[]): Promise<boolean> {
  try {
    const idx = args.indexOf("--cdp-endpoint");
    const endpoint = idx >= 0 ? args[idx + 1] : null;
    if (!endpoint) return false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/json/version`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wrap an MCP tool so execution failures come back as detailed JSON
 * (server, args, real error) instead of a generic "An error occurred."
 * throw that leaves the agent guessing. The model can then narrate the
 * failure and retry or fall back instead of apologizing blindly.
 */
function withMcpErrorDetail(toolName: string, serverName: string, tool: Record<string, any>): Record<string, any> {
  const inner = tool?.execute;
  if (typeof inner !== "function") return tool;
  return {
    ...tool,
    execute: async (args: unknown, opts?: unknown) => {
      try {
        return await inner(args, opts);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[pi-mcp] Tool "${toolName}" (${serverName}) failed:`, msg.slice(0, 500));
        let hint = "Retry once with simpler args; if it fails again, use the closest alternative tool and say what failed.";
        if (/executable doesn't exist|browser.*not found|playwright.*install/i.test(msg)) {
          hint = "The browser binary is missing. Tell the user to run `npx playwright install chromium` once, then retry.";
        } else if (/timeout|timed out/i.test(msg)) {
          hint = "The page or browser took too long. Retry once; if it persists, try a lighter page or web_fetch instead.";
        } else if (/closed|crash|disconnected|EPIPE|SIGTERM/i.test(msg)) {
          hint = "The browser process died. Retry once (it relaunches per call); if it persists, fall back to web_search/web_fetch.";
        }
        return JSON.stringify({
          error: true,
          tool: toolName,
          server: serverName,
          message: msg.slice(0, 1000),
          hint,
        });
      }
    },
  };
}

export async function getMcpToolsForServers(
  servers: McpServerConfig[]
): Promise<{ tools: Record<string, any>; clients: MCPClient[]; errors: Array<{ id: string; name: string; error: string }> }> {
  const allTools: Record<string, any> = {};
  const clients: MCPClient[] = [];
  const errors: Array<{ id: string; name: string; error: string }> = [];

  if (servers.length === 0) {
    return { tools: allTools, clients, errors };
  }

  // Dynamically import to avoid loading mcp in environments where it's not needed
  let createMCPClient: typeof import("@ai-sdk/mcp").createMCPClient;
  let Experimental_StdioMCPTransport: typeof import("@ai-sdk/mcp/mcp-stdio").Experimental_StdioMCPTransport;
  try {
    const mcpMod = await import("@ai-sdk/mcp");
    createMCPClient = mcpMod.createMCPClient;
    const stdioMod = await import("@ai-sdk/mcp/mcp-stdio");
    Experimental_StdioMCPTransport = stdioMod.Experimental_StdioMCPTransport;
  } catch (e: any) {
    console.error("[pi-mcp] Failed to import @ai-sdk/mcp:", e.message);
    // Return empty but report error for each server
    for (const srv of servers) {
      errors.push({ id: srv.id, name: srv.name, error: `MCP SDK not available: ${e.message}` });
    }
    return { tools: allTools, clients, errors };
  }

  // Load each server in parallel, each with its own startup timeout.
  // Fresh client per invocation for determinism (no cross-request reuse:
  // reused stdio clients go stale and leak child processes).
  const results = await Promise.allSettled(
    servers.map(async (srv) => {
      const transport = new Experimental_StdioMCPTransport({
        command: srv.command,
        args: srv.args,
        env: { ...process.env, ...srv.env } as Record<string, string>,
      });

      const client = await withTimeout(
        createMCPClient({
          transport,
          name: `qube-mcp-${srv.id}`,
          version: "1.0.0",
        }),
        MCP_STARTUP_TIMEOUT_MS,
        `MCP server "${srv.name}" connect`
      );

      const tools = await withTimeout(client.tools(), MCP_STARTUP_TIMEOUT_MS, `MCP server "${srv.name}" tools/list`);
      return { srv, client, tools };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const srv = servers[i];
    const r = results[i];
    if (r.status === "fulfilled") {
      const { client, tools } = r.value;
      clients.push(client);
      // Prefix collisions? Keep original tool names; MCP ensures uniqueness per server
      // If duplicate name across servers, later server overwrites — log warning
      for (const [name, tool] of Object.entries(tools)) {
        if (allTools[name]) {
          console.warn(`[pi-mcp] Duplicate tool name "${name}" from server "${srv.name}" overwriting previous`);
        }
        allTools[name] = withMcpErrorDetail(name, srv.name, tool as Record<string, any>);
      }
      console.log(`[pi-mcp] Loaded ${Object.keys(tools).length} tools from ${srv.name} (${srv.command} ${srv.args.join(" ")})`);
    } else {
      const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.error(`[pi-mcp] Failed to load server ${srv.name} (${srv.id}):`, errMsg.slice(0, 500));
      errors.push({ id: srv.id, name: srv.name, error: errMsg.slice(0, 500) });
    }
  }

  return { tools: allTools, clients, errors };
}

export async function loadMcpTools(options?: { threadId?: string; servers?: McpServerConfig[] }): Promise<{
  tools: Record<string, any>;
  clients: MCPClient[];
  errors: Array<{ id: string; name: string; error: string }>;
}> {
  let servers: McpServerConfig[] | null = null;
  if (options?.servers && options.servers.length > 0) {
    servers = options.servers;
  } else {
    try {
      servers = mcpStore.getAll();
    } catch (e) {
      console.error("[pi-mcp] Failed to load from store:", e);
      servers = [];
    }
  }
  // Built-in servers (Browser Use MCP) always load — even when the user
  // has no custom servers (previously an early return skipped them).
  const builtIn = getBuiltInMcpServers();
  const merged: McpServerConfig[] = [...builtIn];
  for (const s of servers || []) {
    const idx = merged.findIndex((m) => m.id === s.id);
    if (idx >= 0) merged[idx] = s;
    else merged.push(s);
  }
  if (builtIn.length > 0 && !merged.some((s) => s.id === BROWSER_MCP_SERVER_ID)) {
    console.log("[pi-mcp] Built-in Browser Use MCP overridden by user config");
  }
  // Filter out invalid configs
  const valid = merged.filter((s) => s.command && s.command.trim() && Array.isArray(s.args));
  if (valid.length !== merged.length) {
    console.warn(`[pi-mcp] Filtered ${merged.length - valid.length} invalid server configs`);
  }
  if (valid.length === 0) {
    return { tools: {}, clients: [], errors: [] };
  }
  // Point the built-in browser at the managed headed Chromium (side-panel
  // mirror) when available; otherwise it launches standalone.
  const browserEntry = valid.find((s) => s.id === BROWSER_MCP_SERVER_ID);
  if (browserEntry) {
    try {
      const { resolveBrowserArgs, resetBrowserArgsCache } = await import("./browser-mcp");
      let resolved = await resolveBrowserArgs();
      if (resolved.managed) {
        // Verify the endpoint is actually alive before handing it to the
        // MCP server — a stale cache otherwise yields ECONNREFUSED at
        // tool-call time with no useful context.
        const alive = await probeCdpEndpoint(resolved.args);
        if (!alive) {
          console.warn("[pi-mcp] Managed endpoint dead — relaunching browser and retrying once");
          try {
            const { restartManagedChrome } = await import("@/lib/browser/managed-chrome");
            await restartManagedChrome();
          } catch {}
          resetBrowserArgsCache();
          resolved = await resolveBrowserArgs();
          if (resolved.managed && !(await probeCdpEndpoint(resolved.args))) {
            console.warn("[pi-mcp] Managed endpoint still dead — falling back to standalone browser");
            const { getBuiltInMcpServers } = await import("./browser-mcp");
            const fallback = getBuiltInMcpServers().find((s) => s.id === BROWSER_MCP_SERVER_ID);
            if (fallback) {
              browserEntry.args = fallback.args;
            } else {
              browserEntry.args = resolved.args;
            }
          } else {
            browserEntry.args = resolved.args;
          }
        } else {
          browserEntry.args = resolved.args;
        }
        if (resolved.managed) {
          console.log("[pi-mcp] Browser tools will drive the managed headed window");
        }
      } else {
        browserEntry.args = resolved.args;
      }
    } catch (e) {
      console.warn("[pi-mcp] Browser arg resolution failed, using defaults:", (e as Error)?.message || String(e));
    }
  }
  return getMcpToolsForServers(valid);
}

export async function closeMcpClients(clients: MCPClient[]): Promise<void> {
  await Promise.allSettled(
    clients.map(async (c) => {
      try {
        await c.close();
      } catch (e) {
        console.warn("[pi-mcp] close failed:", e);
      }
    })
  );
}

// Helper to load MCP servers directly from localStorage-like JSON string (for frontend sync validation)
export function parseMcpServersFromStorage(raw: string | null): McpServerConfig[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as McpServerConfig[];
  } catch {}
  return [];
}
