/**
 * Built-in Browser Use MCP — the single source of truth for browser
 * interaction and navigation.
 *
 * The agent drives a real Chromium instance through this MCP server
 * (Playwright MCP over stdio). The Browser Workspace side panel renders
 * the same live page the agent is acting on — it never reconstructs the
 * page from accessibility trees, extracted text, or screenshots.
 *
 * Override / disable via env (no code changes needed):
 *   BROWSER_MCP_DISABLED=1      — don't add the built-in server
 *   BROWSER_MCP_COMMAND=npx     — custom launcher
 *   BROWSER_MCP_ARGS_JSON='["-y","@playwright/mcp@latest"]'
 *
 * The browser runs headless by default (BROWSER_HEADED=1 shows the OS
 * window) and is shared between the agent (via --cdp-endpoint) and the
 * app's Browser side panel (live screencast + input forwarding), which
 * is the only window most users ever need.
 */
import type { McpServerConfig } from "./mcp-store";

const DEFAULT_COMMAND = process.env.BROWSER_MCP_COMMAND || "npx";

function defaultArgs(): string[] {
  const raw = process.env.BROWSER_MCP_ARGS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
    } catch {
      console.warn("[browser-mcp] Ignoring invalid BROWSER_MCP_ARGS_JSON");
    }
  }
  // NOTE: @playwright/mcp is headed by default and that is intentional —
  // headed Chromium works on bot-guarded sites (Amazon, etc.) where
  // headless/proxied views fail. The user watches the OS window directly.
  // --isolated keeps the profile in memory (no disk residue).
  return ["-y", "@playwright/mcp@latest", "--isolated"];
}

export const BROWSER_MCP_SERVER_ID = "qube-browser-use";

export function getBuiltInMcpServers(): McpServerConfig[] {
  if (process.env.BROWSER_MCP_DISABLED === "1") return [];
  return [
    {
      id: BROWSER_MCP_SERVER_ID,
      name: "Browser Use",
      command: DEFAULT_COMMAND,
      args: defaultArgs(),
      env: {},
    },
  ];
}

// Managed headed Chromium shares ONE persistent window between the agent
// (via --cdp-endpoint) and the app's side panel (via CDP screencast).
// Set BROWSER_MANAGED=0 to let the MCP server launch its own browser.
const MANAGED = process.env.BROWSER_MANAGED !== "0";

let managedArgsCache: { args: string[]; managed: boolean } | null = null;
let managedRetryAfter = 0;

/** Drop cached resolution (after a restart or a dead endpoint). */
export function resetBrowserArgsCache(): void {
  managedArgsCache = null;
  managedRetryAfter = 0;
}

/** Resolve MCP args for the built-in browser: managed CDP endpoint when possible. */
export async function resolveBrowserArgs(): Promise<{ args: string[]; managed: boolean }> {
  if (managedArgsCache) return managedArgsCache;
  if (!MANAGED || process.env.BROWSER_MCP_DISABLED === "1") {
    return { args: defaultArgs(), managed: false };
  }
  if (Date.now() < managedRetryAfter) {
    return { args: defaultArgs(), managed: false };
  }
  try {
    const { ensureManagedChrome } = await import("@/lib/browser/managed-chrome");
    const { endpoint } = await ensureManagedChrome();
    console.log(`[browser-mcp] Using managed headed Chromium at ${endpoint}`);
    // NOTE: no --isolated here — the managed browser already uses a
    // dedicated Qube profile directory.
    managedArgsCache = {
      args: [...defaultArgs(), "--cdp-endpoint", endpoint],
      managed: true,
    };
    return managedArgsCache;
  } catch (e) {
    console.warn(
      "[browser-mcp] Managed browser unavailable, falling back to standalone launch:",
      (e as Error)?.message || String(e)
    );
    // Retry managed launch on a later request instead of caching failure.
    managedRetryAfter = Date.now() + 60_000;
    return { args: defaultArgs(), managed: false };
  }
}

/** Tool names exposed by the Browser Use MCP (Playwright). */
export const BROWSER_MCP_TOOL_PREFIX = "browser_";
