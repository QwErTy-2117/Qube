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

  const withSnapshot = async () => {
    const { snapshot, refs } = await manager.getSnapshotWithRefs(threadId);
    return JSON.stringify({ snapshot, interactiveElements: refs.length });
  };

  const handleError = (error: unknown): string => {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: true, message: msg });
  };

  return {
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
            manager.invalidateCache(threadId);
            const { snapshot, refs } = await manager.getSnapshotWithRefs(threadId);
            return JSON.stringify({ url: page.url(), title: await page.title(), snapshot, interactiveElements: refs.length });
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
            manager.invalidateCache(threadId);
            const { snapshot, refs } = await manager.getSnapshotWithRefs(threadId);
            return JSON.stringify({ url: page.url(), title: await page.title(), snapshot, interactiveElements: refs.length });
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
            manager.invalidateCache(threadId);
            const { snapshot, refs } = await manager.getSnapshotWithRefs(threadId);
            return JSON.stringify({ url: page.url(), title: await page.title(), snapshot, interactiveElements: refs.length });
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

    browser_snapshot: tool({
      description:
        "Get the accessibility tree snapshot of the current page. Shows interactive elements with [ref=N] identifiers you can use with click/type/hover/select tools.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () => {
        try {
          manager.invalidateCache(threadId);
          return await withSnapshot();
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

    browser_click: tool({
      description: "Click an element by its snapshot reference number.",
      inputSchema: refSchema.extend({
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button"),
        modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional().describe("Modifier keys"),
      }),
      execute: async ({ ref, button, modifiers }: { ref: number; button?: "left" | "right" | "middle"; modifiers?: string[] }) => {
        try {
          await manager.interactByRef(threadId, ref, "click", { button, modifiers });
          return JSON.stringify({ clicked: ref });
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
          await manager.typeByRef(threadId, ref, text, submit);
          return JSON.stringify({ typed: ref, text: text.slice(0, 100), submitted: submit ?? false });
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
          for (const f of fields) {
            await manager.typeByRef(threadId, f.ref, f.value);
          }
          return JSON.stringify({ filled: fields.length });
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
          await manager.interactByRef(threadId, ref, "hover");
          return JSON.stringify({ hovered: ref });
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
          await manager.selectOptionByRef(threadId, ref, values);
          return JSON.stringify({ selected: ref, values });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    browser_file_upload: tool({
      description: "Upload files by interacting with a file input element (by snapshot ref).",
      inputSchema: refSchema.extend({
        paths: z.array(z.string()).describe("Absolute file paths to upload"),
      }),
      execute: async ({ ref, paths }: { ref: number; paths: string[] }) => {
        try {
          await manager.fileUploadByRef(threadId, ref, paths);
          return JSON.stringify({ uploaded: ref, files: paths });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

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
                manager.invalidateCache(threadId);
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
              req.response().then((res) => {
                if (res) {
                  requests.push({ url: req.url(), method: req.method(), status: res.status(), type: req.resourceType() });
                }
              }).catch(() => {});
            });
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
          manager.invalidateCache(threadId);
          const { snapshot, refs } = await manager.getSnapshotWithRefs(threadId);
          return JSON.stringify({ profile: name, loaded: true, snapshot, interactiveElements: refs.length });
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
