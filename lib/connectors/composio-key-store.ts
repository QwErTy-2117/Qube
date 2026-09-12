import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

export type ComposioKeyMode = "builtin" | "custom";

export interface ComposioKeyState {
  mode: ComposioKeyMode;
  /** User-provided custom key. Stored server-side in .memory, never sent to the client in full. */
  customKey: string | null;
  updatedAt: number;
}

function composioKeyFilePath(): string {
  // Resolved per call: QUBE_DATA_DIR may change between import time and runtime
  // (dev vs Tauri sidecar), so never freeze the path at module load.
  return join(getDataDir(), ".memory", "composio.json");
}

const DEFAULT_STATE: ComposioKeyState = {
  mode: "builtin",
  customKey: null,
  updatedAt: 0,
};

class ComposioKeyStore {
  private state: ComposioKeyState = { ...DEFAULT_STATE };
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const file = composioKeyFilePath();
      if (existsSync(file)) {
        const raw = readFileSync(file, "utf-8");
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          if (data.mode === "custom" || data.mode === "builtin") {
            this.state.mode = data.mode;
          }
          if (typeof data.customKey === "string" && data.customKey.length > 0) {
            this.state.customKey = data.customKey;
          } else if (data.customKey === null) {
            this.state.customKey = null;
          }
          if (typeof data.updatedAt === "number") {
            this.state.updatedAt = data.updatedAt;
          }
        }
      }
    } catch (e) {
      console.error("[ComposioKeyStore] Failed to load:", e);
    }
  }

  private persist() {
    try {
      const file = composioKeyFilePath();
      const dir = join(getDataDir(), ".memory");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (e) {
      console.error("[ComposioKeyStore] Failed to write:", e);
    }
  }

  getState(): ComposioKeyState {
    this.ensureInitialized();
    return { ...this.state };
  }

  getMode(): ComposioKeyMode {
    this.ensureInitialized();
    return this.state.mode;
  }

  getCustomKey(): string | null {
    this.ensureInitialized();
    return this.state.customKey;
  }

  /** Active custom key: only when mode is custom and a key is saved. */
  getActiveCustomKey(): string | null {
    this.ensureInitialized();
    if (this.state.mode !== "custom") return null;
    return this.state.customKey;
  }

  setMode(mode: ComposioKeyMode) {
    this.ensureInitialized();
    this.state.mode = mode;
    this.state.updatedAt = Date.now();
    this.persist();
  }

  setCustomKey(key: string) {
    this.ensureInitialized();
    this.state.customKey = key;
    this.state.mode = "custom";
    this.state.updatedAt = Date.now();
    this.persist();
  }

  clearCustomKey() {
    this.ensureInitialized();
    this.state.customKey = null;
    this.state.mode = "builtin";
    this.state.updatedAt = Date.now();
    this.persist();
  }
}

export const composioKeyStore = new ComposioKeyStore();

export function maskApiKey(key: string | null): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `••••••••${trimmed.slice(-4)}`;
}
