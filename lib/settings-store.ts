import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

const SETTINGS_FILE = join(getDataDir(), ".memory", "app-settings.json");

export interface AppSettings {
  defaultModel?: string;
  customSystemPrompt?: string;
  temperature?: number;
  userName?: string;
  userAbout?: string;
  runOnStart?: boolean;
  keepAlive?: boolean;
  memoryEnabled?: boolean;
  /** Auto context compaction (default ON). Manual /api/chat/compact still works when off. */
  compactionEnabled?: boolean;
  /** Advanced → Heartbeat and Task: allow built-in tools (default ON). */
  allowTools?: boolean;
  /** Advanced → Heartbeat and Task: allow connected-service tools (default ON). */
  allowConnectors?: boolean;
  /** Advanced → Heartbeat and Task: allow deletes / destructive commands (default OFF). */
  allowDestructiveActions?: boolean;
  /** Advanced → Heartbeat and Task: skip self-review for allowed actions (default OFF). */
  autoApproveActions?: boolean;
}

const defaults: AppSettings = {
  memoryEnabled: true,
  allowTools: true,
  allowConnectors: true,
  allowDestructiveActions: false,
  autoApproveActions: false,
};

class SettingsStore {
  private settings: AppSettings = { ...defaults };
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      if (existsSync(SETTINGS_FILE)) {
        const raw = readFileSync(SETTINGS_FILE, "utf-8");
        this.settings = { ...defaults, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error("[SettingsStore] Failed to load settings:", e);
    }
  }

  /** Hard reset: restore defaults in memory without rewriting the file. */
  resetForHardReset(): void {
    this.initialized = true;
    this.settings = { ...defaults };
  }

  getAll(): AppSettings {
    this.ensureInitialized();
    return { ...this.settings, memoryEnabled: true };
  }

  update(partial: Partial<AppSettings>) {
    this.ensureInitialized();
    this.settings = { ...this.settings, ...partial };
    try {
      const dir = join(getDataDir(), ".memory");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch (e) {
      console.error("[SettingsStore] Failed to write settings:", e);
    }
  }
}

export const settingsStore = new SettingsStore();
