import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

export interface AllowedApp {
  id: string;
  titlePattern: string;
  enabled: boolean;
}

export interface ComputerUseSettings {
  enabled: boolean;
  fullScreen: boolean;
  allowedApps: AllowedApp[];
}

const SETTINGS_FILE = join(getDataDir(), ".memory", "computer-use.json");

const defaults: ComputerUseSettings = {
  enabled: false,
  fullScreen: false,
  allowedApps: [],
};

class ComputerUseStore {
  private settings: ComputerUseSettings = { ...defaults };
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
      console.error("[ComputerUseStore] Failed to load settings:", e);
    }
  }

  getAll(): ComputerUseSettings {
    this.ensureInitialized();
    return { ...this.settings };
  }

  update(partial: Partial<ComputerUseSettings>) {
    this.ensureInitialized();
    this.settings = { ...this.settings, ...partial };
    try {
      const dir = join(getDataDir(), ".memory");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch (e) {
      console.error("[ComputerUseStore] Failed to write settings:", e);
    }
  }

  isTargetAllowed(windowTitle?: string): { allowed: boolean; reason?: string; action?: string } {
    this.ensureInitialized();
    if (!this.settings.enabled) {
      return { allowed: false, reason: "Computer use is disabled.", action: "enable_settings" };
    }
    if (!windowTitle) {
      if (this.settings.fullScreen) return { allowed: true };
      return { allowed: false, reason: "Full-screen access is not granted.", action: "request_permission" };
    }
    const matched = this.settings.allowedApps.find(
      (app) => app.enabled && windowTitle.toLowerCase().includes(app.titlePattern.toLowerCase()),
    );
    if (matched) return { allowed: true };
    return {
      allowed: false,
      reason: `Window "${windowTitle}" is not in the allowed apps list.`,
      action: "request_permission",
    };
  }
}

export const computerUseStore = new ComputerUseStore();
