import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import path from "path";
import fs from "fs";

let mcpClient: MCPClient | null = null;
let initPromise: Promise<MCPClient> | null = null;

function resolveBinaryPath(): string {
  const platformKey = `${process.platform}-${process.arch}`;
  const platformMap: Record<string, string[]> = {
    "darwin-arm64": ["dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"],
    "darwin-x64": ["dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"],
    "linux-arm64": ["dist", "linux", "arm64", "open-computer-use"],
    "linux-x64": ["dist", "linux", "amd64", "open-computer-use"],
    "win32-arm64": ["dist", "windows", "arm64", "open-computer-use.exe"],
    "win32-x64": ["dist", "windows", "amd64", "open-computer-use.exe"],
  };
  const parts = platformMap[platformKey];
  if (!parts) throw new Error(`Unsupported platform: ${platformKey}`);

  // Try require.resolve first
  try {
    const packageRoot = path.dirname(
      require.resolve("open-computer-use/package.json"),
    );
    const binaryPath = path.join(packageRoot, ...parts);
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  } catch {}

  // Fallback to process.cwd()
  const packageRoot = path.join(process.cwd(), "node_modules", "open-computer-use");
  return path.join(packageRoot, ...parts);
}

export async function getComputerClient(): Promise<MCPClient> {
  if (mcpClient) return mcpClient;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const binaryPath = resolveBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`open-computer-use binary not found at ${binaryPath}. Reinstall the package.`);
    }
    try { fs.chmodSync(binaryPath, 0o755); } catch {}

    const transport = new Experimental_StdioMCPTransport({
      command: binaryPath,
      args: ["mcp"],
    });

    const client = await createMCPClient({
      transport,
      name: "qube-computer-use",
      version: "1.0.0",
    });

    mcpClient = client;
    return client;
  })();

  return initPromise;
}

export async function getComputerTools(): Promise<Record<string, any>> {
  const client = await getComputerClient();
  return client.tools();
}

export async function closeComputerClient(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close();
    mcpClient = null;
    initPromise = null;
  }
}
