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
}

const defaults: AppSettings = {};

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

  getAll(): AppSettings {
    this.ensureInitialized();
    return { ...this.settings };
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
