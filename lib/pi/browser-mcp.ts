/**
 * Built-in Browser Use — now backed by open-browser-use
 * (https://github.com/ifuryst/open-browser-use) via `obu mcp`.
 *
 * The agent drives a real Chrome (via extension + native host) and the
 * side panel (BrowserPanel + /api/browser/frames) mirrors the live page.
 * Override via env: BROWSER_MCP_DISABLED=1, BROWSER_MCP_COMMAND, BROWSER_MCP_ARGS_JSON.
 */
import type { McpServerConfig } from "./mcp-store";
import { join } from "node:path";

export const BROWSER_MCP_SERVER_ID = "qube-browser-use";
export const BROWSER_MCP_TOOL_PREFIX = "obu_"; // legacy prefix kept for compat

function resolveCommandAndArgs(): { command: string; args: string[] } {
  const raw = process.env.BROWSER_MCP_ARGS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return { command: process.env.BROWSER_MCP_COMMAND || "obu", args: parsed as string[] };
      }
    } catch {
      console.warn("[browser-mcp] Ignoring invalid BROWSER_MCP_ARGS_JSON");
    }
  }
  if (process.env.BROWSER_MCP_COMMAND) {
    const cmd = process.env.BROWSER_MCP_COMMAND;
    if (cmd.includes(" ")) {
      const parts = cmd.split(" ");
      return { command: parts[0], args: parts.slice(1) };
    }
    // Custom command without args → assume mcp subcommand
    return { command: cmd, args: ["mcp"] };
  }
  // Default: zero-setup auto browser (managed Chrome CDP, no extension).
  // Uses the same tool shapes as `obu mcp` but works automatically via 127.0.0.1:9222.
  // If the user has `obu` installed, they can override via BROWSER_MCP_COMMAND=obu.
  return { command: "node", args: [join(process.cwd(), "lib/browser/auto-mcp/server.mjs")] };
}

export function getBuiltInMcpServers(): McpServerConfig[] {
  if (process.env.BROWSER_MCP_DISABLED === "1") return [];
  const { command, args } = resolveCommandAndArgs();
  return [
    {
      id: BROWSER_MCP_SERVER_ID,
      name: "Browser Use",
      command,
      args,
      env: {},
    },
  ];
}

// Back-compat shims — no longer used (managed Chrome is now separate from
// the open-browser-use session Chrome), but kept so callers don't crash.
export function resetBrowserArgsCache(): void {}
export async function resolveBrowserArgs(): Promise<{ args: string[]; managed: boolean }> {
  const { args } = resolveCommandAndArgs();
  return { args, managed: false };
}
