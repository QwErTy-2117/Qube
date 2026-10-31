/**
 * Pi MCP integration — custom servers from advanced settings.
 * Each server is a stdio MCP transport (command + args + env).
 * Loads server configs from mcpStore (persisted via /api/mcp/sync) and
 * optionally from per-request override.
 */

import { mcpStore, type McpServerConfig } from "./mcp-store";
import { existsSync } from "node:fs";
import { isAbsolute, win32 } from "node:path";

/**
 * Windows spawn fix for MCP stdio servers.
 *
 * Root cause: @ai-sdk/mcp's StdioMCPTransport spawns with `shell: false`.
 * On Windows that means:
 *  - `node` fails with ENOENT when the sidecar/Next server runs with a
 *    minimal PATH (Tauri sidecar, services).
 *  - npm shims (`npx`, `uvx`, `bunx`, …) are `.CMD`/`.BAT` files
 *    which require a shell — spawn without shell always gives ENOENT.
 *
 * Fix: resolve `node` to the absolute running binary and wrap bare/shim
 * commands in `cmd.exe /d /s /c` so they resolve like they do in a terminal.
 */
function quoteForCmd(s: string): string {
  if (s.length === 0) return '""';
  if (!/[\s"]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function normalizeMcpServerForPlatform(srv: McpServerConfig, platform: string = process.platform): McpServerConfig {
  // `platform` is injectable so the Windows-only branches are unit-testable
  // on any OS (live callers omit it). NOTE: never pass this function
  // directly to Array.map — map would feed the element index as `platform`.
  const cmd = (srv.command || "").trim().replace(/^["'](.+)["']$/, "$1");
  const args = Array.isArray(srv.args) ? srv.args : [];
  // Bare `node` (including user-configured servers) → absolute binary.
  if (cmd === "node" || cmd === "node.exe") {
    try {
      if (typeof process.execPath === "string" && existsSync(process.execPath)) {
        return { ...srv, command: process.execPath, args };
      }
    } catch {}
    if (platform === "win32") {
      return { ...srv, command: process.execPath || "node.exe", args };
    }
    return { ...srv, command: cmd, args };
  }
  if (platform !== "win32") return { ...srv, command: cmd, args };

  // Windows from here on.
  const lower = cmd.toLowerCase();
  const hasSep = cmd.includes("/") || cmd.includes("\\");
  // Platform-correct absoluteness: node:path's isAbsolute follows the RUNTIME
  // OS, but under test `platform` may differ — win32.isAbsolute is identical
  // to isAbsolute on real Windows, so production behavior is unchanged.
  const isAbs = platform === "win32" ? win32.isAbsolute(cmd) : isAbsolute(cmd);
  const isExe = lower.endsWith(".exe");
  const isScriptWrapper = lower.endsWith(".cmd") || lower.endsWith(".bat") || lower.endsWith(".ps1");

  // Absolute .exe (e.g. bundled node.exe, chrome.exe) spawns fine directly.
  if (isAbs && isExe && existsSync(cmd)) return { ...srv, command: cmd, args };
  // Absolute JS/script with node already resolved — fine.
  if (isAbs && existsSync(cmd)) return { ...srv, command: cmd, args };

  // Known npm-shim / bare commands need cmd.exe. Also any explicit .cmd/.bat.
  const KNOWN_SHIMS = new Set(["npx", "npx.cmd", "uvx", "uvx.cmd", "bunx", "pnpm", "yarn", "npm", "node"]);
  const base = cmd.split(/[\\/]/).pop() || cmd;
  const needsWrap =
    isScriptWrapper ||
    KNOWN_SHIMS.has(lower) ||
    KNOWN_SHIMS.has(base.toLowerCase()) ||
    (!hasSep && !isExe);

  if (!needsWrap) return { ...srv, command: cmd, args };

  const comspec = process.env.ComSpec || "cmd.exe";
  // cmd.exe /d /s /c "<cmd> <args...>" — single trailing string so quoting is exact.
  const line = [cmd, ...args].map(quoteForCmd).join(" ");
  return { ...srv, command: comspec, args: ["/d", "/s", "/c", line] };
}

function windowsEnoentHint(srv: McpServerConfig, raw: string): string {
  if (process.platform !== "win32") return raw;
  if (!/enoent|spawn.*not found|not recognized/i.test(raw)) return raw;
  return (
    `${raw} — on Windows the MCP command "${srv.command}" could not be started. ` +
    `If it is an npm shim (npx/uvx/bunx) install it globally and restart Qube, or set an absolute command path in Advanced → MCP Servers.`
  );
}

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

/**
 * Wrap an MCP tool so execution failures come back as detailed JSON
 * (server, args, real error) instead of a generic "An error occurred."
 * throw that leaves the agent guessing. The model can then narrate the
 * failure and retry or fall back instead of apologizing blindly.
 */
function withMcpErrorDetail(toolName: string, serverName: string, tool: Record<string, any>): Record<string, any> {
  const inner = tool?.execute;
  if (typeof inner !== "function") return tool;
  // Helper to return a proper CallToolResult shape (so mcpToModelOutput doesn't do 'content' in string)
  const asCallToolResult = (text: string, isError = false) => ({
    content: [{ type: "text", text }],
    isError,
  });

  return {
    ...tool,
    execute: async (args: unknown, opts?: unknown) => {
      try {
        const result = await inner(args, opts);
        return result;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[pi-mcp] Tool "${toolName}" (${serverName}) failed:`, msg.slice(0, 500));
        let hint = "Retry once with simpler args; if it fails again, use the closest alternative tool and say what failed.";
        if (/timeout|timed out/i.test(msg)) {
          hint = "The page or browser took too long. Retry once; if it persists, try a lighter page or web_fetch instead.";
        } else if (/closed|crash|disconnected|EPIPE|SIGTERM/i.test(msg)) {
          hint = "The browser process died. Retry once (it relaunches per call); if it persists, fall back to web_search/web_fetch.";
        }
        return asCallToolResult(
          JSON.stringify({
            error: true,
            tool: toolName,
            server: serverName,
            message: msg.slice(0, 1000),
            hint,
          }),
          true,
        );
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
  const normalized = servers.map((s) => normalizeMcpServerForPlatform(s));
  const results = await Promise.allSettled(
    normalized.map(async (srv) => {
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
    const norm = normalized[i];
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
      console.log(`[pi-mcp] Loaded ${Object.keys(tools).length} tools from ${srv.name} (${norm.command} ${norm.args.join(" ")})`);
    } else {
      const rawMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      const errMsg = windowsEnoentHint(srv, rawMsg);
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
  // Only user-configured servers: Qube's own computer/browser tools are
  // native (lib/computer), not an external MCP bridge.
  const merged: McpServerConfig[] = [...(servers || [])];
  // Filter out invalid configs
  const valid = merged.filter((s) => s.command && s.command.trim() && Array.isArray(s.args));
  if (valid.length !== merged.length) {
    console.warn(`[pi-mcp] Filtered ${merged.length - valid.length} invalid server configs`);
  }
  if (valid.length === 0) {
    return { tools: {}, clients: [], errors: [] };
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
