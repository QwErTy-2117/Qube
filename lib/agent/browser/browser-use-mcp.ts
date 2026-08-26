import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { execSync } from "node:child_process";
import fs from "node:fs";

let mcpClient: MCPClient | null = null;
let initPromise: Promise<MCPClient> | null = null;
let uvInstallTriggered = false;

function triggerUvInstallInBackground(): void {
  if (uvInstallTriggered) return;
  uvInstallTriggered = true;
  try {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    if (process.platform === "win32") {
      spawn("powershell", ["-ExecutionPolicy", "ByPass", "-c", "irm https://astral.sh/uv/install.ps1 | iex"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } else {
      spawn("bash", ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"], {
        detached: true,
        stdio: "ignore",
      }).unref();
    }
    console.log("[browser-use] Triggered background install of uv (required for browser-use)");
  } catch (e) {
    console.error("[browser-use] Failed to trigger uv install", e);
    uvInstallTriggered = false;
  }
}

export function ensureBrowserUseInstalledBackground(): void {
  if (isBrowserUseAvailable()) return;
  triggerUvInstallInBackground();
  // Also try to pre-warm browser-use via uvx in background (will auto-install browser-use[cli] on first run)
  try {
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const uvx = findUvx();
    // Fire-and-forget: this will cause uvx to download browser-use[cli] if uv is available
    spawn(uvx, ["--from", "browser-use[cli]", "browser-use", "--help"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {}
}

function findUvx(): string {
  if (process.env.UVX_PATH && fs.existsSync(process.env.UVX_PATH)) return process.env.UVX_PATH;
  try {
    const cmd = process.platform === "win32" ? "where uvx" : "which uvx";
    const out = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0]?.trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}
  // Common user install locations
  const candidates = [
    `${process.env.HOME}/.local/bin/uvx`,
    `${process.env.HOME}/.cargo/bin/uvx`,
    "/usr/local/bin/uvx",
    "/opt/homebrew/bin/uvx",
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return "uvx";
}

function getBrowserUseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // ALWAYS headless — never open a visible window, as requested
  env.BROWSER_USE_HEADLESS = "true";
  // Pass through relevant API keys if set in Qube's env
  const passthrough = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "BROWSER_USE_API_KEY",
    "BROWSER_USE_LOGGING_LEVEL",
    "OPENAI_BASE_URL",
  ];
  for (const k of passthrough) {
    if (process.env[k]) env[k] = process.env[k]!;
  }
  // Also try to read from Qube's provider store's default API key if available
  // (best-effort: if the default provider is OpenAI, forward its key)
  try {
    const { providerStore } = require("@/lib/agent/provider-store") as typeof import("@/lib/agent/provider-store");
    const def = providerStore.getDefaultModelId();
    if (def) {
      const res = providerStore.getProviderByModel(def);
      if (res?.provider?.apiKey) {
        // Map provider to env key
        const pid = res.provider.id;
        if (pid === "openai" && !env.OPENAI_API_KEY) env.OPENAI_API_KEY = res.provider.apiKey;
        if (pid === "anthropic" && !env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = res.provider.apiKey;
        if (pid === "google" && !env.GOOGLE_API_KEY) env.GOOGLE_API_KEY = res.provider.apiKey;
        if (!env.BROWSER_USE_API_KEY && res.provider.apiKey) env.BROWSER_USE_API_KEY = res.provider.apiKey;
      }
    }
  } catch {}
  return env;
}

export async function getBrowserUseClient(): Promise<MCPClient> {
  if (mcpClient) return mcpClient;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const uvxPath = findUvx();
    const isBare = uvxPath === "uvx";
    if (!isBare && !fs.existsSync(uvxPath)) {
      throw new Error(
        `uvx not found at ${uvxPath}. Install uv (https://docs.astral.sh/uv/getting-started/installation/) and browser-use: uvx --from 'browser-use[cli]' browser-use --help`
      );
    }

    const env = { ...process.env, ...getBrowserUseEnv() } as Record<string, string>;

    const transport = new Experimental_StdioMCPTransport({
      command: uvxPath,
      args: ["--from", "browser-use[cli]", "browser-use", "--mcp"],
      env,
    });

    const client = await createMCPClient({
      transport,
      name: "qube-browser-use",
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

export async function getBrowserUseTools(): Promise<Record<string, any>> {
  const client = await getBrowserUseClient();
  return client.tools();
}

export async function closeBrowserUseClient(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    initPromise = null;
  }
}

export function isBrowserUseAvailable(): boolean {
  try {
    const p = findUvx();
    if (p !== "uvx") return fs.existsSync(p);
    execSync(p === "uvx" ? "uvx --version" : `${p} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
