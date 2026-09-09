import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

function mcpFilePath(): string {
  // Resolved per call: QUBE_DATA_DIR may change between import time and runtime
  // (dev vs Tauri sidecar), so never freeze the path at module load.
  return join(getDataDir(), ".memory", "mcp-servers.json");
}

class McpStore {
  private servers: McpServerConfig[] = [];
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const file = mcpFilePath();
      if (existsSync(file)) {
        const raw = readFileSync(file, "utf-8");
        const data = JSON.parse(raw);
        if (Array.isArray(data?.servers)) {
          this.servers = data.servers as McpServerConfig[];
          return;
        }
        // Legacy: direct array
        if (Array.isArray(data)) {
          this.servers = data as McpServerConfig[];
          return;
        }
      }
    } catch (e) {
      console.error("[McpStore] Failed to load:", e);
    }
  }

  sync(servers: McpServerConfig[], writeToDisk = true) {
    this.ensureInitialized();
    this.servers = [...servers];
    if (writeToDisk) {
      try {
        const file = mcpFilePath();
        const dir = join(getDataDir(), ".memory");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify({ servers: this.servers }, null, 2), "utf-8");
      } catch (e) {
        console.error("[McpStore] Failed to write:", e);
      }
    }
  }

  getAll(): McpServerConfig[] {
    this.ensureInitialized();
    return [...this.servers];
  }

  hasServers(): boolean {
    this.ensureInitialized();
    return this.servers.length > 0;
  }
}

export const mcpStore = new McpStore();
