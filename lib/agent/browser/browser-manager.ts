import type { Browser, BrowserContext, Page } from "playwright";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const PROFILES_DIR = join(process.cwd(), ".memory", "browser-profiles");

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "combobox", "checkbox",
  "radio", "menuitem", "tab", "listbox", "slider",
  "spinbutton", "searchbox",
]);

type SnapshotData = {
  snapshot: string;
  refs: Array<{ ref: number; role: string; name: string }>;
};

export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  private contexts = new Map<string, BrowserContext>();
  private lastActivity = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotCache = new Map<string, SnapshotData>();

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--window-size=1280,720",
        ],
      });
    }
    this.resetIdleTimer();
    return this.browser;
  }

  async getPage(threadId: string): Promise<Page> {
    const browser = await this.ensureBrowser();

    if (!this.contexts.has(threadId)) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });

      await context.addInitScript(() => {
        delete (navigator as any).__proto__.webdriver;
      });

      this.contexts.set(threadId, context);
    }

    const context = this.contexts.get(threadId)!;
    const pages = context.pages();
    if (pages.length > 0) return pages[pages.length - 1];

    return await context.newPage();
  }

  invalidateCache(threadId: string): void {
    this.snapshotCache.delete(threadId);
  }

  private async computeSnapshot(page: Page): Promise<SnapshotData> {
    const raw = await page.locator("html").ariaSnapshot();
    const refs: Array<{ ref: number; role: string; name: string }> = [];
    let refCounter = 0;

    const lines = raw.split("\n");
    const resultLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^(- )(\w+)\s+"([^"]+)"/);
      if (match) {
        const role = match[2].toLowerCase();
        const name = match[3];
        if (INTERACTIVE_ROLES.has(role)) {
          refCounter++;
          refs.push({ ref: refCounter, role, name });
          resultLines.push(line.replace(/[ \t]*$/, "") + ` [ref=${refCounter}]`);
        } else {
          resultLines.push(line);
        }
      } else {
        resultLines.push(line);
      }
    }

    return { snapshot: resultLines.join("\n"), refs };
  }

  async getSnapshotWithRefs(threadId: string): Promise<SnapshotData> {
    const cached = this.snapshotCache.get(threadId);
    if (cached) return cached;

    const page = await this.getPage(threadId);
    const data = await this.computeSnapshot(page);
    this.snapshotCache.set(threadId, data);
    return data;
  }

  private async findRef(threadId: string, ref: number): Promise<{ role: string; name: string }> {
    const { refs } = await this.getSnapshotWithRefs(threadId);
    const target = refs.find((r) => r.ref === ref);
    if (!target) throw new Error(`Element with ref=${ref} not found. Call browser_snapshot to get current refs.`);
    return target;
  }

  async interactByRef(
    threadId: string,
    ref: number,
    action: "click" | "hover" | "focus",
    options?: { button?: "left" | "right" | "middle"; modifiers?: string[] },
  ): Promise<void> {
    const { role, name } = await this.findRef(threadId, ref);
    const page = await this.getPage(threadId);
    const locator = page.getByRole(role as any, { name, exact: true });

    switch (action) {
      case "click":
        await locator.click({ button: options?.button, modifiers: options?.modifiers as any });
        break;
      case "hover":
        await locator.hover();
        break;
      case "focus":
        await locator.focus();
        break;
    }
  }

  async typeByRef(threadId: string, ref: number, text: string, submit?: boolean): Promise<void> {
    const { role, name } = await this.findRef(threadId, ref);
    const page = await this.getPage(threadId);
    const locator = page.getByRole(role as any, { name, exact: true });
    await locator.fill(text);
    if (submit) {
      await page.keyboard.press("Enter");
    }
  }

  async selectOptionByRef(threadId: string, ref: number, values: string[]): Promise<void> {
    const { name } = await this.findRef(threadId, ref);
    const page = await this.getPage(threadId);
    await page.getByRole("combobox", { name, exact: true }).selectOption(values);
  }

  async fileUploadByRef(threadId: string, ref: number, paths: string[]): Promise<void> {
    const { name } = await this.findRef(threadId, ref);
    const page = await this.getPage(threadId);
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name, exact: true }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(paths);
  }

  async evaluate(page: Page, js: string): Promise<string> {
    const result = await page.evaluate(js);
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  async saveProfile(threadId: string, name: string): Promise<void> {
    const context = this.contexts.get(threadId);
    if (!context) throw new Error("No active session to save.");

    const dir = join(PROFILES_DIR, name);
    await mkdir(dir, { recursive: true });

    const cookies = await context.cookies();
    await writeFile(join(dir, "cookies.json"), JSON.stringify(cookies, null, 2));

    const pages = context.pages();
    if (pages.length > 0) {
      try {
        const storage = await pages[0].evaluate(() => JSON.stringify(localStorage));
        await writeFile(join(dir, "localStorage.json"), storage);
      } catch {}
    }
  }

  async loadProfile(threadId: string, name: string): Promise<void> {
    const context = this.contexts.get(threadId);
    if (!context) throw new Error("No active session. Call browser_navigate first.");

    const dir = join(PROFILES_DIR, name);
    const cookiesRaw = await readFile(join(dir, "cookies.json"), "utf-8");
    const cookies = JSON.parse(cookiesRaw);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }

    const pages = context.pages();
    if (pages.length > 0) {
      try {
        const storageRaw = await readFile(join(dir, "localStorage.json"), "utf-8");
        const storage = JSON.parse(storageRaw);
        await pages[0].evaluate((s: Record<string, string>) => {
          for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        }, storage);
      } catch {}
    }
  }

  async listProfiles(): Promise<string[]> {
    try {
      const entries = await readdir(PROFILES_DIR, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  private resetIdleTimer(): void {
    this.lastActivity = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.closeIdle(), 300_000);
  }

  private async closeIdle(): Promise<void> {
    if (Date.now() - this.lastActivity >= 300_000 && this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.contexts.clear();
      this.snapshotCache.clear();
    }
  }

  async closeAll(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const ctx of this.contexts.values()) {
      await ctx.close().catch(() => {});
    }
    this.contexts.clear();
    this.snapshotCache.clear();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
