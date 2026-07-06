# Headless Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full Playwright-based headless browser capabilities (~21 tools) to the AI agent.

**Architecture:** Singleton `BrowserManager` manages one Chromium process with thread-isolated contexts. `BrowserTools` wraps manager into AI SDK `tool()` definitions. Accessibility tree snapshots provide token-efficient page representation. User-managed profiles persist cookies+localStorage to disk.

**Tech Stack:** `playwright` (TypeScript), `ai` SDK `tool()` + `zod`, Next.js app router

---

### Task 1: Install Playwright + Download Chromium

- [ ] **Step 1: Install the Playwright npm package**

Run: `npm install playwright`

- [ ] **Step 2: Download the Chromium browser binary**

Run: `npx playwright install chromium`

- [ ] **Step 3: Verify installation**

Run: `node -e "const { chromium } = require('playwright'); (async () => { const b = await chromium.launch({ headless: true }); console.log('OK'); await b.close(); })()"`

Expected: `OK` printed without errors.

---

### Task 2: Create `lib/agent/browser/browser-manager.ts`

**Files:**
- Create: `lib/agent/browser/browser-manager.ts`

This is the core browser lifecycle manager. Singleton, lazy-launched, thread-isolated contexts, profile persistence, idle timeout.

- [ ] **Step 1: Create the file**

```typescript
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const PROFILES_DIR = join(process.cwd(), ".memory", "browser-profiles");

export class BrowserManager {
  private static instance: BrowserManager;
  private browser: Browser | null = null;
  private contexts = new Map<string, BrowserContext>();
  private lastActivity = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
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

  async getAccessibilitySnapshot(page: Page): Promise<string> {
    const tree = await page.accessibility.snapshot();
    if (!tree) return "[Page has no accessibility tree]";

    const lines: string[] = [];
    let refCounter = 0;

    const flatten = (node: any, depth: number = 0) => {
      const indent = "  ".repeat(depth);
      const ref = ++refCounter;

      const role = (node.role || "").toLowerCase();
      const name = node.name || "";

      const interactive = [
        "button", "link", "textbox", "combobox", "checkbox",
        "radio", "menuitem", "tab", "listbox", "slider",
        "spinbutton", "searchbox",
      ];
      const showRef = interactive.includes(role) || role === "image" || role === "img";

      const refStr = showRef ? ` [ref=${ref}]` : "";

      let urlPart = "";
      if (role === "link" && typeof node.value === "string" && node.value.startsWith("http")) {
        urlPart = ` → ${node.value}`;
      }

      const valueStr =
        node.value && typeof node.value === "string" && !node.value.startsWith("http")
          ? ` value="${node.value}"`
          : "";

      lines.push(`${indent}${role}${name ? ` "${name}"` : ""}${valueStr}${urlPart}${refStr}`);

      if (node.children) {
        for (const child of node.children) {
          flatten(child, depth + 1);
        }
      }
    };

    flatten(tree);
    return lines.join("\n");
  }

  async getSnapshotWithRefs(
    page: Page,
  ): Promise<{ snapshot: string; refs: Array<{ ref: number; role: string; name: string }> }> {
    const tree = await page.accessibility.snapshot();
    const refs: Array<{ ref: number; role: string; name: string }> = [];
    if (!tree) return { snapshot: "[Page has no accessibility tree]", refs };

    const lines: string[] = [];
    let refCounter = 0;

    const flatten = (node: any, depth: number = 0) => {
      const indent = "  ".repeat(depth);
      const ref = ++refCounter;

      const role = (node.role || "").toLowerCase();
      const name = node.name || "";

      const interactive = [
        "button", "link", "textbox", "combobox", "checkbox",
        "radio", "menuitem", "tab", "listbox", "slider",
        "spinbutton", "searchbox",
      ];
      const showRef = interactive.includes(role) || role === "image" || role === "img";

      if (showRef) {
        refs.push({ ref, role, name });
      }

      const refStr = showRef ? ` [ref=${ref}]` : "";

      let urlPart = "";
      if (role === "link" && typeof node.value === "string" && node.value.startsWith("http")) {
        urlPart = ` → ${node.value}`;
      }

      const valueStr =
        node.value && typeof node.value === "string" && !node.value.startsWith("http")
          ? ` value="${node.value}"`
          : "";

      lines.push(`${indent}${role}${name ? ` "${name}"` : ""}${valueStr}${urlPart}${refStr}`);

      if (node.children) {
        for (const child of node.children) {
          flatten(child, depth + 1);
        }
      }
    };

    flatten(tree);
    return { snapshot: lines.join("\n"), refs };
  }

  async interactByRef(
    page: Page,
    ref: number,
    action: "click" | "hover" | "focus",
    options?: { button?: "left" | "right" | "middle"; modifiers?: string[] },
  ): Promise<void> {
    const { refs } = await this.getSnapshotWithRefs(page);
    const target = refs.find((r) => r.ref === ref);
    if (!target) throw new Error(`Element with ref=${ref} not found. Call browser_snapshot to get current refs.`);

    const locator = target.role === "textbox" || target.role === "searchbox"
      ? page.getByRole(target.role as any, { name: target.name, exact: true })
      : page.getByRole(target.role as any, { name: target.name, exact: true });

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

  async typeByRef(page: Page, ref: number, text: string, submit?: boolean): Promise<void> {
    const { refs } = await this.getSnapshotWithRefs(page);
    const target = refs.find((r) => r.ref === ref);
    if (!target) throw new Error(`Element with ref=${ref} not found.`);

    const locator = page.getByRole(target.role as any, { name: target.name, exact: true });
    if (submit) {
      await locator.fill(text);
      await page.keyboard.press("Enter");
    } else {
      await locator.fill(text);
    }
  }

  async selectOptionByRef(page: Page, ref: number, values: string[]): Promise<void> {
    const { refs } = await this.getSnapshotWithRefs(page);
    const target = refs.find((r) => r.ref === ref);
    if (!target) throw new Error(`Element with ref=${ref} not found.`);

    await page.getByRole("combobox", { name: target.name, exact: true }).selectOption(values);
  }

  async fileUploadByRef(page: Page, ref: number, paths: string[]): Promise<void> {
    const { refs } = await this.getSnapshotWithRefs(page);
    const target = refs.find((r) => r.ref === ref);
    if (!target) throw new Error(`Element with ref=${ref} not found.`);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: target.name, exact: true }).click();
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
    }
  }

  async closeAll(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const ctx of this.contexts.values()) {
      await ctx.close().catch(() => {});
    }
    this.contexts.clear();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
```

---

### Task 3: Create `lib/agent/browser/browser-tools.ts`

**Files:**
- Create: `lib/agent/browser/browser-tools.ts`

All ~21 browser tool definitions. Uses `BrowserManager` singleton. Each tool returns serialized JSON.

- [ ] **Step 1: Create the file**

```typescript
import { tool } from "ai";
import { z } from "zod";
import { BrowserManager } from "./browser-manager";

const refSchema = z.object({
  label: z.string().optional(),
  ref: z.number().describe("Element reference number from the accessibility snapshot"),
});

export function createBrowserTools(threadId: string) {
  const manager = BrowserManager.getInstance();

  const withPage = async <T>(fn: (page: import("playwright").Page) => Promise<T>): Promise<T> => {
    const page = await manager.getPage(threadId);
    return fn(page);
  };

  const handleError = (error: unknown): string => {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: true, message: msg });
  };

  return {
    // ── Navigation ──
    browser_navigate: tool({
      description: "Navigate to a URL. Returns the page title and accessibility snapshot.",
      inputSchema: z.object({
        label: z.string().optional(),
        url: z.string().describe("The URL to navigate to"),
      }),
      execute: async ({ url }: { url: string }) => {
        try {
          return await withPage(async (page) => {
            let targetUrl = url.trim();
            if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
              targetUrl = "https://" + targetUrl;
            }
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            const title = await page.title();
            const { snapshot, refs } = await manager.getSnapshotWithRefs(page);
            return JSON.stringify({ url: page.url(), title, snapshot, interactiveElements: refs.length });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_navigate_back: tool({
      description: "Go back to the previous page. Returns the accessibility snapshot.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () => {
        try {
          return await withPage(async (page) => {
            await page.goBack({ timeout: 30000 });
            const title = await page.title();
            const { snapshot, refs } = await manager.getSnapshotWithRefs(page);
            return JSON.stringify({ url: page.url(), title, snapshot, interactiveElements: refs.length });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_reload: tool({
      description: "Reload the current page. Returns the accessibility snapshot.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () => {
        try {
          return await withPage(async (page) => {
            await page.reload({ timeout: 30000 });
            const title = await page.title();
            const { snapshot, refs } = await manager.getSnapshotWithRefs(page);
            return JSON.stringify({ url: page.url(), title, snapshot, interactiveElements: refs.length });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_wait_for: tool({
      description: "Wait for text to appear on the page or for a specified time in seconds.",
      inputSchema: z.object({
        label: z.string().optional(),
        text: z.string().optional().describe("Text to wait for to appear"),
        time: z.number().optional().describe("Time in seconds to wait"),
      }),
      execute: async ({ text, time }: { text?: string; time?: number }) => {
        try {
          return await withPage(async (page) => {
            if (text) {
              await page.waitForSelector(`text="${text}"`, { timeout: 30000 });
              return JSON.stringify({ waitedFor: "text", text, found: true });
            }
            if (time) {
              await page.waitForTimeout(time * 1000);
              return JSON.stringify({ waitedFor: "time", seconds: time });
            }
            return JSON.stringify({ error: true, message: "Provide either 'text' or 'time'" });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    // ── Page Reading ──
    browser_snapshot: tool({
      description:
        "Get the accessibility tree snapshot of the current page. Shows interactive elements with [ref=N] identifiers you can use with click/type/hover/select tools.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () => {
        try {
          return await withPage(async (page) => {
            const { snapshot, refs } = await manager.getSnapshotWithRefs(page);
            return JSON.stringify({ snapshot, interactiveElements: refs.length });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_take_screenshot: tool({
      description: "Capture a screenshot of the current page. Returns a base64 data URI.",
      inputSchema: z.object({
        label: z.string().optional(),
        fullPage: z.boolean().optional().describe("Capture full scrollable page"),
      }),
      execute: async ({ fullPage }: { fullPage?: boolean }) => {
        try {
          return await withPage(async (page) => {
            const buffer = await page.screenshot({ fullPage: fullPage ?? false, type: "png" });
            const b64 = buffer.toString("base64");
            return JSON.stringify({ dataUri: `data:image/png;base64,${b64}`, format: "png", fullPage: fullPage ?? false });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    // ── Interaction ──
    browser_click: tool({
      description: "Click an element by its snapshot reference number.",
      inputSchema: refSchema.extend({
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button"),
        modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional().describe("Modifier keys"),
      }),
      execute: async ({ ref, button, modifiers }: { ref: number; button?: "left" | "right" | "middle"; modifiers?: string[] }) => {
        try {
          return await withPage(async (page) => {
            await manager.interactByRef(page, ref, "click", { button, modifiers });
            const { snapshot, refs } = await manager.getSnapshotWithRefs(page);
            return JSON.stringify({ clicked: ref, snapshot, interactiveElements: refs.length });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_type: tool({
      description: "Type text into an input element identified by snapshot reference.",
      inputSchema: refSchema.extend({
        text: z.string().describe("Text to type"),
        submit: z.boolean().optional().describe("Press Enter after typing"),
      }),
      execute: async ({ ref, text, submit }: { ref: number; text: string; submit?: boolean }) => {
        try {
          return await withPage(async (page) => {
            await manager.typeByRef(page, ref, text, submit);
            return JSON.stringify({ typed: ref, text: text.slice(0, 100), submitted: submit ?? false });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_fill_form: tool({
      description: "Fill multiple form fields at once using snapshot refs.",
      inputSchema: z.object({
        label: z.string().optional(),
        fields: z.array(z.object({
          ref: z.number(),
          value: z.string(),
        })).describe("Array of { ref, value } pairs for each form field"),
      }),
      execute: async ({ fields }: { fields: Array<{ ref: number; value: string }> }) => {
        try {
          return await withPage(async (page) => {
            for (const f of fields) {
              await manager.typeByRef(page, f.ref, f.value);
            }
            return JSON.stringify({ filled: fields.length });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_hover: tool({
      description: "Hover over an element identified by snapshot reference.",
      inputSchema: refSchema,
      execute: async ({ ref }: { ref: number }) => {
        try {
          return await withPage(async (page) => {
            await manager.interactByRef(page, ref, "hover");
            return JSON.stringify({ hovered: ref });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_press_key: tool({
      description: "Press a keyboard key (e.g. 'Enter', 'Escape', 'ArrowDown', 'Tab').",
      inputSchema: z.object({
        label: z.string().optional(),
        key: z.string().describe("Key name (e.g. 'Enter', 'Escape', 'ArrowDown', 'Tab')"),
      }),
      execute: async ({ key }: { key: string }) => {
        try {
          return await withPage(async (page) => {
            await page.keyboard.press(key);
            return JSON.stringify({ key });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_select_option: tool({
      description: "Select options from a dropdown/select element by snapshot reference.",
      inputSchema: refSchema.extend({
        values: z.array(z.string()).describe("Option values or labels to select"),
      }),
      execute: async ({ ref, values }: { ref: number; values: string[] }) => {
        try {
          return await withPage(async (page) => {
            await manager.selectOptionByRef(page, ref, values);
            return JSON.stringify({ selected: ref, values });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_file_upload: tool({
      description: "Upload files by clicking a file input element (by snapshot ref) and selecting files.",
      inputSchema: refSchema.extend({
        paths: z.array(z.string()).describe("Absolute file paths to upload"),
      }),
      execute: async ({ ref, paths }: { ref: number; paths: string[] }) => {
        try {
          return await withPage(async (page) => {
            await manager.fileUploadByRef(page, ref, paths);
            return JSON.stringify({ uploaded: ref, files: paths });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    // ── Tab Management ──
    browser_tabs: tool({
      description: "List, create, close, or switch between browser tabs.",
      inputSchema: z.object({
        label: z.string().optional(),
        action: z.enum(["list", "new", "close", "select"]).describe("Action to perform"),
        url: z.string().optional().describe("URL to open in new tab (required for action=new)"),
        index: z.number().optional().describe("Tab index to close or select"),
      }),
      execute: async ({ action, url, index }: { action: string; url?: string; index?: number }) => {
        try {
          return await withPage(async (page) => {
            const context = page.context();

            switch (action) {
              case "list": {
                const pages = context.pages();
                const tabs = await Promise.all(
                  pages.map(async (p, i) => ({
                    index: i,
                    url: p.url(),
                    title: await p.title(),
                  })),
                );
                return JSON.stringify({ tabs, total: tabs.length });
              }
              case "new": {
                const newPage = await context.newPage();
                if (url) {
                  let targetUrl = url.trim();
                  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
                    targetUrl = "https://" + targetUrl;
                  }
                  await newPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
                }
                return JSON.stringify({ action: "new", url: newPage.url(), title: await newPage.title() });
              }
              case "close": {
                if (index === undefined) return JSON.stringify({ error: true, message: "index required for close" });
                const pages = context.pages();
                if (index < 0 || index >= pages.length) {
                  return JSON.stringify({ error: true, message: `Tab index ${index} out of range` });
                }
                await pages[index].close();
                return JSON.stringify({ action: "close", index });
              }
              case "select": {
                if (index === undefined) return JSON.stringify({ error: true, message: "index required for select" });
                const pages = context.pages();
                if (index < 0 || index >= pages.length) {
                  return JSON.stringify({ error: true, message: `Tab index ${index} out of range` });
                }
                await pages[index].bringToFront();
                return JSON.stringify({ action: "select", index, url: pages[index].url(), title: await pages[index].title() });
              }
              default:
                return JSON.stringify({ error: true, message: `Unknown action: ${action}` });
            }
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    // ── Advanced ──
    browser_evaluate: tool({
      description: "Execute JavaScript in the browser page context and return the result.",
      inputSchema: z.object({
        label: z.string().optional(),
        js: z.string().describe("JavaScript code to execute"),
      }),
      execute: async ({ js }: { js: string }) => {
        try {
          return await withPage(async (page) => {
            const result = await manager.evaluate(page, js);
            return JSON.stringify({ result });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_console_messages: tool({
      description: "Get browser console log messages.",
      inputSchema: z.object({
        label: z.string().optional(),
        level: z.enum(["error", "warning", "info", "debug"]).optional().describe("Filter by severity"),
      }),
      execute: async ({ level }: { level?: string }) => {
        try {
          return await withPage(async (page) => {
            const messages: Array<{ level: string; text: string }> = [];
            page.on("console", (msg) => {
              const l = msg.type();
              if (!level || l === level) {
                messages.push({ level: l, text: msg.text() });
              }
            });
            return JSON.stringify({ messages, count: messages.length });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_network_requests: tool({
      description: "List network requests made by the page (since last snapshot).",
      inputSchema: z.object({
        label: z.string().optional(),
        static: z.boolean().optional().describe("Include static resources (images, fonts, etc.)"),
        filter: z.string().optional().describe("URL pattern to filter by"),
      }),
      execute: async ({ static: includeStatic, filter }: { static?: boolean; filter?: string }) => {
        try {
          return await withPage(async (page) => {
            const requests: Array<{ url: string; method: string; status: number; type: string }> = [];
            page.on("request", (req) => {
              if (!includeStatic && ["image", "font", "stylesheet", "media"].includes(req.resourceType())) return;
              if (filter && !req.url().includes(filter)) return;
              // We capture response status asynchronously
              req.response().then((res) => {
                if (res) {
                  requests.push({ url: req.url(), method: req.method(), status: res.status(), type: req.resourceType() });
                }
              }).catch(() => {});
            });
            // Wait a tick for any captured requests
            await new Promise((r) => setTimeout(r, 500));
            return JSON.stringify({ requests, count: requests.length });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_scroll: tool({
      description: "Scroll the page by pixels or by viewport height.",
      inputSchema: z.object({
        label: z.string().optional(),
        direction: z.enum(["down", "up"]).describe("Scroll direction"),
        amount: z.number().describe("Pixels to scroll (use 0 to scroll by viewport height)"),
      }),
      execute: async ({ direction, amount }: { direction: string; amount: number }) => {
        try {
          return await withPage(async (page) => {
            const px = amount === 0 ? await page.evaluate(() => window.innerHeight) : amount;
            const delta = direction === "down" ? px : -px;
            await page.evaluate((d) => window.scrollBy(0, d), delta);
            return JSON.stringify({ direction, pixels: delta });
          });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    // ── Profile Management ──
    browser_save_profile: tool({
      description: "Save the current browser session (cookies, localStorage) as a named profile.",
      inputSchema: z.object({
        label: z.string().optional(),
        name: z.string().describe("Profile name (e.g. 'gmail', 'github')"),
      }),
      execute: async ({ name }: { name: string }) => {
        try {
          await manager.saveProfile(threadId, name);
          return JSON.stringify({ profile: name, saved: true });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_load_profile: tool({
      description: "Restore a saved browser profile (cookies, localStorage).",
      inputSchema: z.object({
        label: z.string().optional(),
        name: z.string().describe("Profile name to load"),
      }),
      execute: async ({ name }: { name: string }) => {
        try {
          await manager.loadProfile(threadId, name);
          const page = await manager.getPage(threadId);
          const title = await page.title();
          return JSON.stringify({ profile: name, loaded: true, currentUrl: page.url(), title });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_list_profiles: tool({
      description: "List all saved browser profiles.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () => {
        try {
          const profiles = await manager.listProfiles();
          return JSON.stringify({ profiles, count: profiles.length });
        } catch (e) {
          return handleError(e);
        }
      },
    }),
  };
}
```

---

### Task 4: Integrate browser tools into `lib/agent/agent.ts`

**Files:**
- Modify: `lib/agent/agent.ts` — add import and spread browser tools

- [ ] **Step 1: Add import at top of `agent.ts`**

At line 6 (after the existing imports), add:

```typescript
import { createBrowserTools } from "./browser/browser-tools";
```

- [ ] **Step 2: Spread browser tools into the tools object**

Inside `createAgent`, after line 309 (before the closing `}) as any`):

Replace:

```typescript
    }) as any,
```

With:

```typescript
      ...createBrowserTools(threadId),
    }) as any,
```

The end result should look like:

```typescript
      ask_user: tool({
        ...
      }),

      ...createBrowserTools(threadId),
    }) as any,
  });
```

---

### Task 5: Create browser tool UI component

**Files:**
- Create: `components/assistant-ui/tools/browser-tool-ui.tsx`
- Modify: `components/assistant-ui/tools/index.ts` — export new UI
- Modify: `components/assistant-ui/agent-runtime-provider.tsx` — register tool UIs

- [ ] **Step 1: Create `browser-tool-ui.tsx`**

```typescript
"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const BrowserNavigateToolUI: ToolCallMessagePartComponent = ({ args, result }) => {
  const url = (args as any)?.url || "";
  let data: { url?: string; title?: string; snapshot?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {data.url && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">URL:</span>
          <span className="truncate font-mono text-xs text-blue-600 dark:text-blue-400">
            {data.url}
          </span>
        </div>
      )}
      {data.title && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Title:</span>
          <span className="text-xs font-medium">{data.title}</span>
        </div>
      )}
      {data.snapshot && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Accessibility Snapshot
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            {data.snapshot}
          </pre>
        </details>
      )}
    </div>
  );
};

export const BrowserScreenshotToolUI: ToolCallMessagePartComponent = ({ result }) => {
  let data: { dataUri?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {data.dataUri ? (
        <img
          src={data.dataUri}
          alt="Browser screenshot"
          className="w-full rounded-md border"
        />
      ) : (
        <span className="text-xs text-muted-foreground">Screenshot captured</span>
      )}
    </div>
  );
};

export const BrowserToolUI: ToolCallMessagePartComponent = ({ args, result }) => {
  const toolName = (args as any)?.label || "browser";
  let data: Record<string, unknown> = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as Record<string, unknown>;
  } catch {}

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Tool:</span>
        <span className="font-mono text-xs font-medium">{toolName}</span>
      </div>
      {data.snapshot && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Accessibility Snapshot
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            {data.snapshot as string}
          </pre>
        </details>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Export new components from `index.ts`**

Add to `components/assistant-ui/tools/index.ts`:

```typescript
export { BrowserNavigateToolUI, BrowserScreenshotToolUI, BrowserToolUI } from "./browser-tool-ui";
```

- [ ] **Step 3: Register tool UIs in `agent-runtime-provider.tsx`**

Add imports:

```typescript
import {
  BrowserNavigateToolUI,
  BrowserScreenshotToolUI,
  BrowserToolUI,
} from "@/components/assistant-ui/tools";
```

Add registrations inside `ToolUIRegistrar`:

```typescript
useAssistantToolUI({ toolName: "browser_navigate", render: BrowserNavigateToolUI });
useAssistantToolUI({ toolName: "browser_take_screenshot", render: BrowserScreenshotToolUI });
useAssistantToolUI({ toolName: "browser_snapshot", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_click", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_type", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_fill_form", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_hover", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_press_key", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_select_option", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_file_upload", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_tabs", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_evaluate", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_console_messages", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_network_requests", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_scroll", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_save_profile", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_load_profile", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_list_profiles", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_navigate_back", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_reload", render: BrowserToolUI });
useAssistantToolUI({ toolName: "browser_wait_for", render: BrowserToolUI });
```

---

### Task 6: Update `.gitignore`

- [ ] **Step 1: Add browser-profiles to `.gitignore`**

Append to `.gitignore`:

```
.memory/browser-profiles/
```

---

### Task 7: Update system prompt

**Files:**
- Modify: `lib/agent/system-prompt.ts`

- [ ] **Step 1: Add browser tool guidance section**

After the "Other rules" section in `system-prompt.ts`, add a new section:

```typescript
- **Browser tools**: Use browser_* tools for interactive websites, forms, login flows, and JS-heavy pages. Use web_search/web_fetch for simple text extraction. Pattern: browser_navigate → browser_snapshot (see refs) → browser_click(click a button)/browser_type(type into input) → browser_snapshot (verify result). Call browser_snapshot after every navigation to get updated element refs.
```

---

### Task 8: Verify build

- [ ] **Step 1: TypeScript compilation check**

Run: `npx tsc --noEmit --pretty`

Expected: No type errors.

- [ ] **Step 2: Build check**

Run: `npm run build`

Expected: Build succeeds.

---

### Task 9: Post-implementation notes

- Browser manager is lazy — no overhead until first `browser_*` tool call
- Each chat thread gets isolated cookies/storage
- Profiles stored in `.memory/browser-profiles/` (gitignored)
- 5-min idle timeout auto-closes browser to free memory
- The `browser_snapshot` tool only shows interactive elements with refs to keep token count low (~200-400 tokens)
