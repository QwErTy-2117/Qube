/**
 * Built-in Browser Use — now backed by open-browser-use
 * (https://github.com/ifuryst/open-browser-use) via `obu mcp`.
 *
 * The agent drives a real Chrome (via extension + native host) and the
 * side panel (BrowserPanel + /api/browser/frames) mirrors the live page.
 * Override via env: BROWSER_MCP_DISABLED=1, BROWSER_MCP_COMMAND, BROWSER_MCP_ARGS_JSON.
 */
import type { McpServerConfig } from "./mcp-store";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const BROWSER_MCP_SERVER_ID = "qube-browser-use";
export const BROWSER_MCP_TOOL_PREFIX = "obu_"; // legacy prefix kept for compat

function resolveNodeBinary(): string {
  // On Windows the Next.js server often runs with a minimal PATH (Tauri
  // sidecar, service, etc.) where `node` is not resolvable, which surfaces
  // as `spawn node ENOENT` with shell:false. process.execPath is the exact
  // Node binary running this server, so it always exists.
  try {
    if (typeof process.execPath === "string" && process.execPath.length > 0) {
      if (existsSync(process.execPath)) return process.execPath;
    }
  } catch {}
  return process.platform === "win32" ? "node.exe" : "node";
}

function resolveCommandAndArgs(): { command: string; args: string[] } {
  const raw = process.env.BROWSER_MCP_ARGS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        const cmd = process.env.BROWSER_MCP_COMMAND || "obu";
        // Bare `node` in env override also needs the absolute binary on Windows.
        if (cmd === "node" || cmd === "node.exe") {
          return { command: resolveNodeBinary(), args: parsed as string[] };
        }
        return { command: cmd, args: parsed as string[] };
      }
    } catch {
      console.warn("[browser-mcp] Ignoring invalid BROWSER_MCP_ARGS_JSON");
    }
  }
  if (process.env.BROWSER_MCP_COMMAND) {
    const cmd = process.env.BROWSER_MCP_COMMAND;
    if (cmd.includes(" ")) {
      const parts = cmd.split(" ");
      const c0 = parts[0] === "node" || parts[0] === "node.exe" ? resolveNodeBinary() : parts[0];
      return { command: c0, args: parts.slice(1) };
    }
    // Custom command without args → assume mcp subcommand
    if (cmd === "node" || cmd === "node.exe") {
      return { command: resolveNodeBinary(), args: ["mcp"] };
    }
    return { command: cmd, args: ["mcp"] };
  }
  // Default: zero-setup auto browser (managed Chrome CDP, no extension).
  // Uses the same tool shapes as `obu mcp` but works automatically via 127.0.0.1:9222.
  // If the user has `obu` installed, they can override via BROWSER_MCP_COMMAND=obu.
  // Use the absolute Node binary so Windows never needs PATH lookup for `node`.
  return { command: resolveNodeBinary(), args: [join(process.cwd(), "lib/browser/auto-mcp/server.mjs")] };
}

export function getBuiltInMcpServers(): McpServerConfig[] {
  if (process.env.BROWSER_MCP_DISABLED === "1") return [];
  const { command, args } = resolveCommandAndArgs();
  // Fail loudly with the resolved path instead of a bare "Connection closed"
  // from the MCP client when the child exits on a missing script (e.g. an
  // incomplete production bundle — see scripts/build-sidecar.js).
  const isNode = command === "node" || command === "node.exe" || command.endsWith("/node") || command.endsWith("\\node") || command.endsWith("node.exe");
  if (isNode && args.length > 0 && !existsSync(args[0])) {
    console.error(
      `[browser-mcp] Built-in Browser Use MCP script missing at ${args[0]} (cwd=${process.cwd()}) — ` +
        `browser tools will fail to start. Set BROWSER_MCP_DISABLED=1 to silence, or fix the bundle.`,
    );
  }
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
