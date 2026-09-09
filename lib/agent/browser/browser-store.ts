/**
 * Browser live-page state.
 *
 * Single source of truth for *which page* the Browser Workspace shows:
 * the URL the Browser Use MCP is acting on (synced from MCP tool calls)
 * or entered by the user in the panel address bar.
 *
 * Deliberately URL-only — the panel renders the actual live website
 * itself (embedded browser view). No accessibility trees, extracted
 * text, link lists, or screenshots are stored or reconstructed here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

export type BrowserPageState = {
  url: string;
  updatedAt: number;
  version: number;
};

const FILE = () => join(getDataDir(), ".memory", "browser-session.json");

function blank(): BrowserPageState {
  return { url: "", updatedAt: Date.now(), version: 0 };
}

class BrowserStore {
  private state: BrowserPageState = blank();
  private loaded = false;

  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(FILE())) {
        const parsed = JSON.parse(readFileSync(FILE(), "utf-8")) as Partial<BrowserPageState>;
        if (typeof parsed.url === "string") {
          this.state = {
            url: parsed.url.slice(0, 2048),
            updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
            version: typeof parsed.version === "number" ? parsed.version : 0,
          };
        }
      }
    } catch (e) {
      console.error("[browser-store] load failed:", e);
    }
  }

  private persist() {
    try {
      const dir = join(getDataDir(), ".memory");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(FILE(), JSON.stringify(this.state, null, 2), "utf-8");
    } catch (e) {
      console.error("[browser-store] persist failed:", e);
    }
  }

  get(): BrowserPageState {
    this.ensureLoaded();
    return { ...this.state };
  }

  /** Public snapshot for the client — URL only, no paths, no secrets. */
  publicSnapshot(): BrowserPageState {
    return this.get();
  }

  setUrl(url: string) {
    this.ensureLoaded();
    const next = url.trim().slice(0, 2048);
    if (!next || next === this.state.url) return;
    this.state = { url: next, updatedAt: Date.now(), version: this.state.version + 1 };
    this.persist();
  }

  reset() {
    this.state = { ...blank(), version: this.state.version + 1 };
    this.persist();
  }
}

export const browserStore = new BrowserStore();
