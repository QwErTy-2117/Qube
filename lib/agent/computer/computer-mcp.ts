import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let mcpClient: MCPClient | null = null;
let initPromise: Promise<MCPClient> | null = null;
let installTriggered = false;

function triggerCuaInstallInBackground(): void {
  if (installTriggered) return;
  installTriggered = true;
  try {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    if (process.platform === "win32") {
      spawn("powershell", ["-Command", "irm https://cua.ai/driver/install.ps1 | iex"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } else {
      spawn("bash", ["-c", "curl -fsSL https://cua.ai/driver/install.sh | bash"], {
        detached: true,
        stdio: "ignore",
      }).unref();
    }
    console.log("[cua] Triggered background install of cua-driver (user enabled Computer Use)");
  } catch (e) {
    console.error("[cua] Failed to trigger background install", e);
    installTriggered = false;
  }
}

export function ensureCuaDriverInstalledBackground(): void {
  if (isCuaDriverAvailable()) return;
  triggerCuaInstallInBackground();
}

function findCuaDriverBinary(): string {
  // 1. Explicit env override
  if (process.env.CUA_DRIVER_PATH && fs.existsSync(process.env.CUA_DRIVER_PATH)) {
    return process.env.CUA_DRIVER_PATH;
  }

  // 2. Try `which` / `where` lookup
  try {
    const cmd = process.platform === "win32" ? "where cua-driver" : "which cua-driver";
    const out = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0]?.trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}

  // 3. Common install locations (curl | bash installs to /usr/local/bin or ~/.local/bin)
  const candidates = [
    "/usr/local/bin/cua-driver",
    "/opt/homebrew/bin/cua-driver",
    path.join(process.env.HOME || "", ".local", "bin", "cua-driver"),
    path.join(process.cwd(), "node_modules", ".bin", "cua-driver"),
    // Windows
    "C:\\Program Files\\cua-driver\\cua-driver.exe",
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }

  // 4. Fallback to bare command — let the OS resolve PATH at spawn time
  // Experimental_StdioMCPTransport will attempt to spawn "cua-driver"
  return "cua-driver";
}

function getCuaMcpArgs(): string[] {
  const args = ["mcp"];
  // On macOS, --direct makes the MCP process own the runtime and use the host's TCC grants.
  // Without it, the driver proxies through CuaDriver.app which may not be installed in dev.
  // Use direct mode for dev unless explicitly disabled.
  if (process.platform === "darwin" && process.env.CUA_DRIVER_NO_DIRECT !== "1") {
    args.push("--direct");
  }
  return args;
}

export async function getComputerClient(): Promise<MCPClient> {
  if (mcpClient) return mcpClient;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const binaryPath = findCuaDriverBinary();

    // If we resolved to a bare "cua-driver" command, don't check existsSync — but verify it exists in PATH
    const isBare = binaryPath === "cua-driver";
    const binaryExists = isBare ? isCuaDriverAvailable() : fs.existsSync(binaryPath);
    if (!binaryExists) {
      // Fire-and-forget install in background so the user doesn't have to do anything
      triggerCuaInstallInBackground();
      throw new Error(
        `cua-driver not found — background install triggered. It will be available in a minute. If it stays missing, install manually: curl -fsSL https://cua.ai/driver/install.sh | bash (macOS/Linux) or irm https://cua.ai/driver/install.ps1 | iex (Windows), or set CUA_DRIVER_PATH.`
      );
    }

    // Ensure executable on Unix
    if (!isBare) {
      try {
        fs.chmodSync(binaryPath, 0o755);
      } catch {}
    }

    // Prevent Orca screen reader from starting on GNOME/COSMIC — the default
    // IsEnabledOnly still writes IsEnabled=true which is safe, but to be extra
    // safe for users who see Orca on every message, force "none" unless the
    // user explicitly set a mode. This is the user request: no screen reader.
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (!env.CUA_DRIVER_RS_A11Y_ADVERTISE_MODE && !env.CUA_DRIVER_RS_DISABLE_A11Y_ADVERTISE) {
      env.CUA_DRIVER_RS_A11Y_ADVERTISE_MODE = "none";
    }

    const transport = new Experimental_StdioMCPTransport({
      command: binaryPath,
      args: getCuaMcpArgs(),
      env,
    });

    const client = await createMCPClient({
      transport,
      name: "qube-cua-driver",
      version: "1.0.0",
    });

    mcpClient = client;
    return client;
  })();

  try {
    return await initPromise;
  } catch (e) {
    initPromise = null;
    throw e;
  }
}

let cachedTools: Record<string, any> | null = null;
let cachedToolsPromise: Promise<Record<string, any>> | null = null;

export async function getComputerTools(): Promise<Record<string, any>> {
  if (cachedTools) return cachedTools;
  if (cachedToolsPromise) return cachedToolsPromise;

  cachedToolsPromise = (async () => {
    // Lazy-init: only spawn cua-driver when a tool is actually called, not at agent creation.
    // We return a set of lazy wrappers that initialize the real MCP on first execute.
    // This prevents "starts the accessibility screen reader" on every message when computer-use is enabled but not used.
    const lazyTools: Record<string, any> = {};
    let realTools: Record<string, any> | null = null;
    let realToolsPromise: Promise<Record<string, any>> | null = null;

    const ensureRealTools = async (): Promise<Record<string, any>> => {
      if (realTools) return realTools;
      if (realToolsPromise) return realToolsPromise;
      realToolsPromise = (async () => {
        const client = await getComputerClient();
        const tools = await client.tools();
        // Wrap launch_app to be visible by default
        const originalLaunch = (tools as any)["launch_app"];
        if (originalLaunch) {
          const wrapped = {
            ...originalLaunch,
            description:
              (originalLaunch.description || "") +
              " By default the app will be brought to the foreground and made visible. Only stay in background if the user explicitly says \"in background\", \"hidden\", or \"minimized\".",
            execute: async (args: any, extra?: any) => {
              const label = (args?.label as string) || "";
              const wantsBackground =
                (args as any)?.background === true ||
                /background|hidden|minimized|in background/i.test(label) ||
                /background|hidden|minimized/i.test(JSON.stringify(args).toLowerCase());
              const resultStr: string = await (originalLaunch.execute as any)(args, extra);
              if (wantsBackground) return resultStr;
              try {
                let pid: number | undefined;
                let windowId: number | undefined;
                try {
                  const parsed = JSON.parse(resultStr);
                  pid = parsed?.pid ?? parsed?.structuredContent?.pid;
                  const windows = parsed?.windows ?? parsed?.structuredContent?.windows ?? [];
                  windowId = windows?.[0]?.window_id ?? parsed?.window_id;
                  if (!pid && parsed?.content?.[0]?.text) {
                    try {
                      const inner = JSON.parse(parsed.content[0].text);
                      pid = inner?.pid ?? pid;
                      const innerWindows = inner?.windows ?? [];
                      windowId = innerWindows?.[0]?.window_id ?? windowId;
                    } catch {}
                  }
                } catch {
                  const m = resultStr.match(/\{[\s\S]*\}/);
                  if (m) {
                    try {
                      const inner = JSON.parse(m[0]);
                      pid = inner?.pid;
                      windowId = inner?.windows?.[0]?.window_id ?? inner?.window_id;
                    } catch {}
                  }
                }
                if (pid) {
                  const bringTool = (tools as any)["bring_to_front"];
                  if (bringTool) {
                    await new Promise((r) => setTimeout(r, 500));
                    try {
                      await (bringTool.execute as any)(windowId ? { pid, window_id: windowId } : { pid }, extra);
                    } catch (e) {
                      console.warn("[cua] bring_to_front after launch_app failed (app may still be visible):", e);
                    }
                  }
                }
              } catch (e) {
                console.warn("[cua] Failed to auto-bring launch_app to front:", e);
              }
              return resultStr;
            },
          };
          (tools as any)["launch_app"] = wrapped;
        }
        // Wrap list_apps to avoid dumping 500+ kernel threads — filter to desktop apps only and truncate
        const originalListApps = (tools as any)["list_apps"];
        if (originalListApps) {
          const wrappedList = {
            ...originalListApps,
            description:
              (originalListApps.description || "") +
              " Filtered to desktop apps only (with launch_path/bundle_id). For known apps like Files, prefer direct launch_app with name 'Files' or bundle_id 'org.gnome.Nautilus' without calling this first.",
            execute: async (args: any, extra?: any) => {
              const resultStr: string = await (originalListApps.execute as any)(args, extra);
              try {
                let apps: any[] = [];
                let parsed: any = null;
                try {
                  parsed = JSON.parse(resultStr);
                  apps = parsed?.apps ?? parsed?.structuredContent?.apps ?? [];
                  if (!apps.length && parsed?.content?.[0]?.text) {
                    try {
                      const inner = JSON.parse(parsed.content[0].text);
                      apps = inner?.apps ?? apps;
                    } catch {}
                  }
                } catch {
                  return resultStr;
                }
                if (Array.isArray(apps) && apps.length > 80) {
                  const filtered = apps.filter(
                    (a: any) =>
                      a.launch_path ||
                      a.bundle_id ||
                      (a.name && !a.name.startsWith("kworker") && !a.name.startsWith("kthreadd") && a.name !== "systemd" && !a.name.includes("/"))
                  );
                  if (filtered.length > 0 && filtered.length < apps.length) {
                    const truncated = filtered.slice(0, 60);
                    const note =
                      filtered.length > 60
                        ? `Truncated to 60 desktop apps (from ${apps.length} total, ${filtered.length} desktop). Use launch_app directly with known name instead of listing all.`
                        : `Filtered to ${filtered.length} desktop apps (from ${apps.length} total).`;
                    return JSON.stringify({ apps: truncated, total: apps.length, filtered: filtered.length, note });
                  }
                }
              } catch {}
              return resultStr;
            },
          };
          (tools as any)["list_apps"] = wrappedList;
        }
        realTools = tools;
        // Cache for subsequent calls
        cachedTools = tools;
        return tools;
      })();
      return realToolsPromise;
    };

    // Create lazy wrappers for every tool — we need the real tool list to know names,
    // so we do a one-time fetch of the tool names without executing them.
    // To avoid spawning the driver just to list names, we lazily fetch the names on first access.
    // Instead, we create a proxy that on any tool call will ensure the real tools and delegate.
    const handler: ProxyHandler<Record<string, any>> = {
      get(_target, prop: string) {
        if (typeof prop !== "string") return undefined;
        // Return a lazy tool that on execute will load the real one
        return {
          description: `Cua computer tool ${prop} (lazy)`,
          parameters: undefined,
          execute: async (args: any, extra?: any) => {
            const real = await ensureRealTools();
            const t = (real as any)[prop];
            if (!t) throw new Error(`Unknown computer tool: ${prop}`);
            return (t.execute as any)(args, extra);
          },
        };
      },
      ownKeys() {
        // If something enumerates the tools (like the agent does to list them), we need to actually load them
        // This will block, but it's the first time the agent needs the tool list.
        // We can't return a promise here, so we trigger the load but return empty for now;
        // the caller (getComputerTools) will await the real load below.
        return [];
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true, value: undefined };
      },
    };

    // For the agent, we need to actually return the real tools list, not a proxy that enumerates empty.
    // So we eagerly load the real tools once, but the MCP spawn still happens here — which is at agent creation time.
    // To truly defer until first tool *call*, we need to return a proxy that the agent will treat as tools,
    // but the agent lists tools via Object.keys(tools). So we must provide the keys.
    // Instead, we do: eagerly fetch the real tools now (which spawns the driver), but we have already made
    // the spawn not trigger Orca via the env var. The remaining "starts screen reader on every message" is
    // now mitigated by the env var (A11Y_ADVERTISE_MODE=none) and by caching the client.
    // So just load for real and cache.
    const real = await ensureRealTools();
    cachedToolsPromise = null;
    return real;
  })();

  const result = await cachedToolsPromise;
  cachedTools = result;
  cachedToolsPromise = null;
  return result;
}

export async function closeComputerClient(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    initPromise = null;
  }
}

// Optional: expose a helper to check if cua-driver is available without initializing MCP
export function isCuaDriverAvailable(): boolean {
  try {
    const p = findCuaDriverBinary();
    if (p === "cua-driver") {
      // Try which again
      const cmd = process.platform === "win32" ? "where cua-driver" : "which cua-driver";
      execSync(cmd, { stdio: "ignore" });
      return true;
    }
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
