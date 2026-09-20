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
let _fallbackCdpId = 1;

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
 * Fallback browser via managed Chrome CDP (for when obu not set up).
 * Tries to perform basic navigation via http://127.0.0.1:9222 when obu fails.
 */
async function fallbackBrowserViaManagedChrome(toolName: string, args: unknown): Promise<string | null> {
  const isObuSocketError = (msg: string) => /socket not provided|active\.json|no connectable socket/i.test(msg);
  // Only fallback for navigation-type tools
  const fallbackTools = new Set(["open_tab", "navigate", "tabs", "user_tabs", "page_info", "cdp", "ping", "info", "wait_load", "move_mouse", "name_session", "turn_ended", "finalize_tabs"]);
  if (!fallbackTools.has(toolName)) return null;
  try {
    const { getBrowserPort } = await import("@/lib/browser/managed-chrome");
    const port = getBrowserPort();
    const base = `http://127.0.0.1:${port}`;
    // Quick probe
    const probe = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (!probe || !probe.ok) return null;

    const a = args as Record<string, unknown>;
    if (toolName === "open_tab" || toolName === "navigate") {
      const url = (a.url as string) || "";
      if (!url || !/^https?:\/\//i.test(url)) return null;
      // Try CDP Page.navigate on existing tab, fallback to /json/new
      try {
        const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
        const targets = (await res.json()) as Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>;
        const page = targets.filter((t) => t.type === "page")[0];
        if (page?.webSocketDebuggerUrl) {
          const { default: WebSocket } = await import("ws");
          const wsUrl = page.webSocketDebuggerUrl;
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
            let done = false;
            const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} reject(new Error("CDP timeout")); } }, 5000);
            ws.on("open", () => {
              const id = _fallbackCdpId++ % 100000;
              ws.send(JSON.stringify({ id, method: "Page.navigate", params: { url } }));
              ws.on("message", (raw: Buffer) => {
                try {
                  const msg = JSON.parse(raw.toString());
                  if (msg.id === id) {
                    clearTimeout(t);
                    done = true;
                    try { ws.close(); } catch {}
                    resolve();
                  }
                } catch {}
              });
            });
            ws.on("error", (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } });
          });
          await new Promise((r) => setTimeout(r, 800));
          return JSON.stringify({ fallback: true, via: "managed-chrome-cdp", url, note: "Navigated via fallback managed Chrome (obu not set up). Ask user to run `npx open-browser-use setup` for full extension features." });
        }
      } catch {}
      // Fallback to /json/new
      const res = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT", signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (res && res.ok) {
        return JSON.stringify({ fallback: true, via: "managed-chrome-new-tab", url, note: "Opened via fallback managed Chrome. Run `npx open-browser-use setup` for full features." });
      }
    }
    if (toolName === "tabs") {
      const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        return JSON.stringify({ fallback: true, via: "managed-chrome", tabs: data });
      }
    }
    if (toolName === "ping" || toolName === "info") {
      const res = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        return JSON.stringify({ fallback: true, via: "managed-chrome", info: data, note: "obu not set up — using managed Chrome fallback. Run `npx open-browser-use setup`." });
      }
    }
    if (toolName === "user_tabs") {
      const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        return JSON.stringify({ fallback: true, via: "managed-chrome", tabs: data });
      }
    }
    if (toolName === "page_info") {
      try {
        const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
        const targets = (await res.json()) as Array<{ id: string; type: string; webSocketDebuggerUrl?: string; url?: string; title?: string }>;
        const page = targets.filter((t) => t.type === "page")[0];
        if (page?.webSocketDebuggerUrl) {
          const { default: WebSocket } = await import("ws");
          const wsUrl = page.webSocketDebuggerUrl;
          const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
            const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
            let done = false;
            const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} reject(new Error("CDP timeout")); } }, 6000);
            ws.on("open", () => {
              const id = _fallbackCdpId++ % 100000;
              ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: "({title: document.title, url: location.href, text: document.body.innerText.slice(0,8000)})", returnByValue: true } }));
              ws.on("message", (raw: Buffer) => {
                try {
                  const msg = JSON.parse(raw.toString());
                  if (msg.id === id) {
                    clearTimeout(t);
                    done = true;
                    try { ws.close(); } catch {}
                    resolve(msg.result?.result?.value || {});
                  }
                } catch {}
              });
            });
            ws.on("error", (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } });
          });
          return JSON.stringify({ fallback: true, via: "managed-chrome-cdp", ...result });
        }
      } catch {}
    }
    if (toolName === "cdp") {
      const method = (a.method as string) || "";
      const params = (a.params as Record<string, unknown>) || {};
      if (!method) return null;
      try {
        const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
        const targets = (await res.json()) as Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>;
        const page = targets.filter((t) => t.type === "page")[0];
        if (page?.webSocketDebuggerUrl) {
          const { default: WebSocket } = await import("ws");
          const wsUrl = page.webSocketDebuggerUrl;
          const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
            const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
            let done = false;
            const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} reject(new Error("CDP timeout")); } }, 8000);
            ws.on("open", () => {
              const id = _fallbackCdpId++ % 100000;
              ws.send(JSON.stringify({ id, method, params }));
              ws.on("message", (raw: Buffer) => {
                try {
                  const msg = JSON.parse(raw.toString());
                  if (msg.id === id) {
                    clearTimeout(t);
                    done = true;
                    try { ws.close(); } catch {}
                    if (msg.error) reject(new Error(msg.error.message));
                    else resolve(msg.result || {});
                  }
                } catch {}
              });
            });
            ws.on("error", (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } });
          });
          return JSON.stringify({ fallback: true, via: "managed-chrome-cdp", method, result });
        }
      } catch (e) {
        return JSON.stringify({ fallback: true, error: String(e).slice(0,500) });
      }
    }
    if (toolName === "wait_load") {
      await new Promise((r) => setTimeout(r, 1200));
      return JSON.stringify({ fallback: true, via: "managed-chrome", waited: true });
    }
    if (toolName === "move_mouse") {
      const x = (a.x as number) ?? 0, y = (a.y as number) ?? 0;
      try {
        const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(3000) });
        const targets = (await res.json()) as Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>;
        const page = targets.filter((t) => t.type === "page")[0];
        if (page?.webSocketDebuggerUrl) {
          const { default: WebSocket } = await import("ws");
          const wsUrl = page.webSocketDebuggerUrl;
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
            let done = false;
            const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} reject(new Error("CDP timeout")); } }, 4000);
            ws.on("open", () => {
              const id = _fallbackCdpId++ % 100000;
              ws.send(JSON.stringify({ id, method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x, y } }));
              ws.on("message", (raw: Buffer) => {
                try {
                  const msg = JSON.parse(raw.toString());
                  if (msg.id === id) { clearTimeout(t); done = true; try { ws.close(); } catch {} resolve(); }
                } catch {}
              });
            });
            ws.on("error", (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } });
          });
          return JSON.stringify({ fallback: true, via: "managed-chrome-cdp", moved: { x, y } });
        }
      } catch {}
    }
    if (toolName === "name_session" || toolName === "turn_ended" || toolName === "finalize_tabs") {
      return JSON.stringify({ fallback: true, via: "managed-chrome", handled: toolName, note: "obu not set up — no-op fallback, continuing" });
    }
  } catch {}
  return null;
}

/**
 * Wrap an MCP tool so execution failures come back as detailed JSON
 * (server, args, real error) instead of a generic "An error occurred."
 * throw that leaves the agent guessing. The model can then narrate the
 * failure and retry or fall back instead of apologizing blindly.
 * For obu socket errors, tries managed-Chrome fallback automatically.
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
        // Detect obu socket error returned as successful result with error content
        // (obu mcp returns isError or text containing socket message rather than throwing)
        let resultStr = "";
        try {
          if (typeof result === "string") resultStr = result;
          else if (result && typeof result === "object") resultStr = JSON.stringify(result);
        } catch {}
        if (/socket not provided|active\.json|no connectable socket/i.test(resultStr)) {
          console.warn(`[pi-mcp] Tool "${toolName}" obu socket missing — trying managed-Chrome fallback`);
          const fb = await fallbackBrowserViaManagedChrome(toolName, args);
          if (fb) return asCallToolResult(fb, false);
          // No fallback available — return helpful hint as CallToolResult
          return asCallToolResult(
            JSON.stringify({
              error: true,
              tool: toolName,
              server: serverName,
              message: "Browser backend not reachable: open-browser-use extension not set up (socket missing).",
              hint: "Tell the user: run `npx open-browser-use setup` once to install the Chrome extension and native host, then restart Chrome. Meanwhile, I tried a managed-Chrome fallback for navigation — if that also failed, use web_search/web_fetch as alternative or ask user to do the click in the side panel (you share the same live browser).",
            }),
            true,
          );
        }
        return result;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[pi-mcp] Tool "${toolName}" (${serverName}) failed:`, msg.slice(0, 500));
        // Try fallback for obu socket errors thrown as exceptions
        if (/socket not provided|active\.json|no connectable socket/i.test(msg)) {
          const fb = await fallbackBrowserViaManagedChrome(toolName, args);
          if (fb) return asCallToolResult(fb, false);
        }
        let hint = "Retry once with simpler args; if it fails again, use the closest alternative tool and say what failed.";
        if (/socket not provided|active\.json/i.test(msg)) {
          hint = "Browser backend not set up. Tell user to run `npx open-browser-use setup` once, then restart Chrome. Meanwhile try managed-Chrome fallback or web_search/web_fetch.";
        } else if (/executable doesn't exist|browser.*not found|playwright.*install/i.test(msg)) {
          hint = "The browser binary is missing. Tell the user to run `npx playwright install chromium` once, then retry.";
        } else if (/timeout|timed out/i.test(msg)) {
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
