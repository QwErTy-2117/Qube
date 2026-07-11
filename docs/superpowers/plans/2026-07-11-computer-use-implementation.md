# Computer Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the Qube agent to control the user's desktop — take screenshots, move the mouse, click, type, press keys, scroll, and drag — gated by an explicit allow list configured in Advanced settings.

**Architecture:** `@nut-tree-fork/nut-js` provides cross-platform screen capture, mouse, keyboard, and window management. A singleton `ComputerManager` wraps it with per-thread state. Tools check against a `ComputerUseStore` (allowed apps list + full screen toggle). Missing targets trigger the existing permission-widget system. Only image-capable models can use computer tools.

**Tech Stack:** `@nut-tree-fork/nut-js` (mouse, keyboard, window management), `screenshot-desktop` (screen capture → PNG buffer), Zod (input validation), existing permission middleware.

> **IMPORTANT:** The package is `@nut-tree-fork/nut-js` (NOT `@nut-tree/nut-js`, which is deprecated). All imports use `@nut-tree-fork/nut-js`.

---

### Task 1: Install @nut-tree-fork/nut-js + create computer-store.ts

**Files:**
- Modify: `package.json`
- Create: `lib/agent/computer/computer-store.ts`
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Add dependencies to package.json**

```json
"@nut-tree-fork/nut-js": "^4.2.0",
"screenshot-desktop": "^1.15.0",
```

Insert alphabetically in the `dependencies` block.

- [ ] **Step 2: Add libxtst-dev to Linux build deps in .github/workflows/build.yml**

```yaml
      - name: Install dependencies (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            libxtst-dev \
            patchelf \
            rpm
```

Add `libxtst-dev` after `librsvg2-dev`.

- [ ] **Step 3: Run npm install**

```bash
npm install
```

Expected: `@nut-tree-fork/nut-js` added to `package-lock.json`.

- [ ] **Step 4: Create lib/agent/computer/computer-store.ts**

```typescript
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

  isTargetAllowed(windowTitle?: string): boolean {
    this.ensureInitialized();
    if (!this.settings.enabled) return false;
    if (!windowTitle) return this.settings.fullScreen;
    return this.settings.allowedApps.some(
      (app) => app.enabled && windowTitle.toLowerCase().includes(app.titlePattern.toLowerCase()),
    );
  }
}

export const computerUseStore = new ComputerUseStore();
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/agent/computer/computer-store.ts .github/workflows/build.yml
git commit -m "feat: add @nut-tree-fork/nut-js dep and computer-use store"
```

---

### Task 2: Create computer-manager.ts

**Files:**
- Create: `lib/agent/computer/computer-manager.ts`

- [ ] **Step 1: Create lib/agent/computer/computer-manager.ts**

```typescript
import { computerUseStore } from "./computer-store";

interface WindowInfo {
  title: string;
  pid: number;
}

class ComputerManager {
  private static instance: ComputerManager;
  private focusedWindow: string | null = null;

  static getInstance(): ComputerManager {
    if (!ComputerManager.instance) {
      ComputerManager.instance = new ComputerManager();
    }
    return ComputerManager.instance;
  }

  async screenshot(windowTitle?: string): Promise<{ base64: string; width: number; height: number }> {
    if (windowTitle) {
      try {
        const { getWindows } = await import("@nut-tree-fork/nut-js");
        const windows = await getWindows();
        const target = windows.find((w) =>
          w.title.toLowerCase().includes(windowTitle.toLowerCase()),
        );
        if (target) {
          await target.focus();
        }
      } catch {
        // Focus is best-effort
      }
    }

    // screenshot-desktop returns PNG Buffer directly
    const screenshot = (await import("screenshot-desktop")).default;
    const pngBuffer = await screenshot({ format: "png" });
    const { width, height } = await this.getPngDimensions(pngBuffer);
    return { base64: pngBuffer.toString("base64"), width, height };
  }

  private async getPngDimensions(buf: Buffer): Promise<{ width: number; height: number }> {
    // PNG header: IHDR chunk at offset 16 (width: 4 bytes, height: 4 bytes, big-endian)
    if (buf.length < 24) return { width: 0, height: 0 };
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }

  async click(x: number, y: number, button: "left" | "right" | "middle" = "left") {
    const { mouse, Button } = await import("@nut-tree-fork/nut-js");
    await mouse.setPosition({ x, y });
    const btnMap = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };
    await mouse.click(btnMap[button]);
  }

  async type(text: string) {
    const { keyboard } = await import("@nut-tree-fork/nut-js");
    await keyboard.type(text);
  }

  async pressKey(keys: string) {
    const { keyboard, Key } = await import("@nut-tree-fork/nut-js");
    const parts = keys.toLowerCase().split("+").map((k) => k.trim());
    const keyMap: Record<string, any> = {
      "ctrl": Key.LeftControl,
      "alt": Key.LeftAlt,
      "shift": Key.LeftShift,
      "meta": Key.LeftWin,
      "enter": Key.Enter,
      "tab": Key.Tab,
      "escape": Key.Escape,
      "backspace": Key.Backspace,
      "delete": Key.Delete,
      "up": Key.Up,
      "down": Key.Down,
      "left": Key.Left,
      "right": Key.Right,
      "space": Key.Space,
      "home": Key.Home,
      "end": Key.End,
      "pageup": Key.PageUp,
      "pagedown": Key.PageDown,
    };
    const nutKeys = parts.map((p) => keyMap[p] || p);
    await keyboard.pressKey(...nutKeys);
  }

  async moveMouse(x: number, y: number) {
    const { mouse } = await import("@nut-tree-fork/nut-js");
    await mouse.setPosition({ x, y });
  }

  async scroll(x: number, y: number, direction: "up" | "down" | "left" | "right", amount: number) {
    const { mouse } = await import("@nut-tree-fork/nut-js");
    await mouse.setPosition({ x, y });
    for (let i = 0; i < amount; i++) {
      if (direction === "up") await mouse.scrollUp(1);
      else if (direction === "down") await mouse.scrollDown(1);
      else if (direction === "left") await mouse.scrollLeft(1);
      else await mouse.scrollRight(1);
    }
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number) {
    const { mouse, Button } = await import("@nut-tree-fork/nut-js");
    await mouse.setPosition({ x: fromX, y: fromY });
    await mouse.pressButton(Button.LEFT);
    await mouse.setPosition({ x: toX, y: toY });
    await mouse.releaseButton(Button.LEFT);
  }

  async listWindows(): Promise<WindowInfo[]> {
    try {
      const { getWindows } = await import("@nut-tree-fork/nut-js");
      const windows = await getWindows();
      return windows
        .filter((w) => w.title && w.title.trim().length > 0)
        .map((w) => ({
          title: w.title,
          pid: w.pid ?? 0,
        }));
    } catch {
      return [];
    }
  }

  async focusWindow(titlePattern: string): Promise<boolean> {
    try {
      const { getWindows } = await import("@nut-tree-fork/nut-js");
      const windows = await getWindows();
      const target = windows.find((w) =>
        w.title.toLowerCase().includes(titlePattern.toLowerCase()),
      );
      if (target) {
        await target.focus();
        this.focusedWindow = target.title;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const computerManager = ComputerManager.getInstance();
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/computer/computer-manager.ts
git commit -m "feat: create computer-manager wrapping @nut-tree-fork/nut-js"
```

---

### Task 3: Create computer-tools.ts

**Files:**
- Create: `lib/agent/computer/computer-tools.ts`

- [ ] **Step 1: Create lib/agent/computer/computer-tools.ts**

```typescript
import { tool } from "ai";
import { z } from "zod";
import { computerManager } from "./computer-manager";
import { computerUseStore } from "./computer-store";
import { withPermissionCheck } from "@/lib/middleware/permission-middleware";

export function createComputerTools(threadId: string) {
  const withPermission = (
    name: string,
    args: Record<string, unknown>,
    fn: () => Promise<string>,
  ) => {
    const permDescription = `The agent wants to use the computer (${name})`;
    return withPermissionCheck(
      name,
      args,
      threadId,
      async () => fn(),
    );
  };

  const checkTarget = (windowTitle?: string): string | null => {
    if (computerUseStore.isTargetAllowed(windowTitle)) return null;
    return `Computer use not permitted for target "${windowTitle || "full screen"}". Configure access in Advanced > Computer Use settings.`;
  };

  return {
    computer_screenshot: tool({
      description: "Capture the screen. Optionally specify a window title to focus that window first. Returns a base64-encoded PNG image.",
      inputSchema: z.object({
        windowTitle: z.string().optional().describe("Window title substring to focus before capture. Omit for full screen."),
        label: z.string().optional(),
      }),
      execute: async ({ windowTitle, label }) => {
        const denied = checkTarget(windowTitle);
        if (denied) return withPermission("computer_screenshot", { windowTitle }, async () => {
          const img = await computerManager.screenshot(windowTitle);
          return JSON.stringify(img);
        });
        const img = await computerManager.screenshot(windowTitle);
        return JSON.stringify(img);
      },
    }),

    computer_click: tool({
      description: "Click at screen coordinates.",
      inputSchema: z.object({
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
        button: z.enum(["left", "right", "middle"]).optional().default("left"),
        label: z.string().optional(),
      }),
      execute: async ({ x, y, button }) => {
        const denied = checkTarget();
        if (denied) return withPermission("computer_click", { x, y }, async () => {
          await computerManager.click(x, y, button);
          return JSON.stringify({ x, y, button, status: "clicked" });
        });
        await computerManager.click(x, y, button);
        return JSON.stringify({ x, y, button, status: "clicked" });
      },
    }),

    computer_type: tool({
      description: "Type text at the current cursor position.",
      inputSchema: z.object({
        text: z.string().describe("Text to type"),
        label: z.string().optional(),
      }),
      execute: async ({ text }) => {
        const denied = checkTarget();
        if (denied) return withPermission("computer_type", { text }, async () => {
          await computerManager.type(text);
          return JSON.stringify({ status: "typed", length: text.length });
        });
        await computerManager.type(text);
        return JSON.stringify({ status: "typed", length: text.length });
      },
    }),

    computer_press_key: tool({
      description: "Press a key or key combination (e.g. 'ctrl+c', 'enter', 'alt+tab').",
      inputSchema: z.object({
        keys: z.string().describe("Key or key combination (e.g. 'ctrl+c', 'enter', 'alt+tab')"),
        label: z.string().optional(),
      }),
      execute: async ({ keys }) => {
        const denied = checkTarget();
        if (denied) return withPermission("computer_press_key", { keys }, async () => {
          await computerManager.pressKey(keys);
          return JSON.stringify({ keys, status: "pressed" });
        });
        await computerManager.pressKey(keys);
        return JSON.stringify({ keys, status: "pressed" });
      },
    }),

    computer_move_mouse: tool({
      description: "Move the mouse cursor to screen coordinates.",
      inputSchema: z.object({
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
        label: z.string().optional(),
      }),
      execute: async ({ x, y }) => {
        const denied = checkTarget();
        if (denied) return withPermission("computer_move_mouse", { x, y }, async () => {
          await computerManager.moveMouse(x, y);
          return JSON.stringify({ x, y, status: "moved" });
        });
        await computerManager.moveMouse(x, y);
        return JSON.stringify({ x, y, status: "moved" });
      },
    }),

    computer_scroll: tool({
      description: "Scroll at screen coordinates.",
      inputSchema: z.object({
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
        direction: z.enum(["up", "down", "left", "right"]),
        amount: z.number().int().min(1).max(100).default(1).describe("Number of scroll steps"),
        label: z.string().optional(),
      }),
      execute: async ({ x, y, direction, amount }) => {
        const denied = checkTarget();
        if (denied) return withPermission("computer_scroll", { x, y, direction }, async () => {
          await computerManager.scroll(x, y, direction, amount);
          return JSON.stringify({ x, y, direction, amount, status: "scrolled" });
        });
        await computerManager.scroll(x, y, direction, amount);
        return JSON.stringify({ x, y, direction, amount, status: "scrolled" });
      },
    }),

    computer_drag: tool({
      description: "Drag the mouse from one coordinate to another (press + move + release).",
      inputSchema: z.object({
        fromX: z.number().describe("Starting X coordinate"),
        fromY: z.number().describe("Starting Y coordinate"),
        toX: z.number().describe("Ending X coordinate"),
        toY: z.number().describe("Ending Y coordinate"),
        label: z.string().optional(),
      }),
      execute: async ({ fromX, fromY, toX, toY }) => {
        const denied = checkTarget();
        if (denied) return withPermission("computer_drag", { fromX, fromY, toX, toY }, async () => {
          await computerManager.drag(fromX, fromY, toX, toY);
          return JSON.stringify({ fromX, fromY, toX, toY, status: "dragged" });
        });
        await computerManager.drag(fromX, fromY, toX, toY);
        return JSON.stringify({ fromX, fromY, toX, toY, status: "dragged" });
      },
    }),

    computer_list_windows: tool({
      description: "List open windows with their titles. Use to find the title of a window you want to target with computer_screenshot.",
      inputSchema: z.object({
        label: z.string().optional(),
      }),
      execute: async () => {
        const windows = await computerManager.listWindows();
        return JSON.stringify({ windows, total: windows.length });
      },
    }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/computer/computer-tools.ts
git commit -m "feat: create computer-tools with 8 tools"
```

---

### Task 4: Create API routes

**Files:**
- Create: `app/api/computer/settings/route.ts`
- Create: `app/api/computer/available-apps/route.ts`

- [ ] **Step 1: Create app/api/computer/settings/route.ts**

```typescript
import { computerUseStore, type ComputerUseSettings } from "@/lib/agent/computer/computer-store";

export async function GET() {
  try {
    const settings = computerUseStore.getAll();
    return Response.json({ settings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { settings } = body as { settings: Partial<ComputerUseSettings> };
    if (!settings || typeof settings !== "object") {
      return Response.json({ ok: false, error: "settings must be an object" }, { status: 400 });
    }
    computerUseStore.update(settings);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create app/api/computer/available-apps/route.ts**

```typescript
import { computerManager } from "@/lib/agent/computer/computer-manager";

export async function GET() {
  try {
    const windows = await computerManager.listWindows();
    return Response.json({ windows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/computer/
git commit -m "feat: add computer/settings and computer/available-apps API routes"
```

---

### Task 5: Update agent.ts and system-prompt.ts

**Files:**
- Modify: `lib/agent/agent.ts`
- Modify: `lib/agent/system-prompt.ts`

- [ ] **Step 1: Add import and conditional tools in agent.ts**

Add this import at the top of `lib/agent/agent.ts`:
```typescript
import { computerUseStore } from "./computer/computer-store";
import { createComputerTools } from "./computer/computer-tools";
import { detectModelImageSupport } from "@/components/shared/settings-dialog";
```

At the end of the tools object, after `...createBrowserTools(threadId)`, add:
```typescript
      ...(() => {
        const cuSettings = computerUseStore.getAll();
        if (!cuSettings.enabled) return {};
        const modelName = config.modelName || "";
        const colonIdx = modelName.indexOf(":");
        const modelId = colonIdx >= 0 ? modelName.slice(colonIdx + 1) : modelName;
        if (!detectModelImageSupport(modelId)) return {};
        return createComputerTools(threadId);
      })(),
```

So the full tools object should look like:
```typescript
    tools: ({
      read_file: tool({ ... }),
      // ... all existing tools ...
      ...createBrowserTools(threadId),
      ...(() => {
        const cuSettings = computerUseStore.getAll();
        if (!cuSettings.enabled) return {};
        const modelName = config.modelName || "";
        const colonIdx = modelName.indexOf(":");
        const modelId = colonIdx >= 0 ? modelName.slice(colonIdx + 1) : modelName;
        if (!detectModelImageSupport(modelId)) return {};
        return createComputerTools(threadId);
      })(),
    }) as any,
```

- [ ] **Step 2: Add computer use instructions to system-prompt.ts**

Edit `lib/agent/system-prompt.ts` — add a new `## Computer Use` section before `${memorySection}` at the end:

```typescript
## Computer Use

You have access to computer_* tools that let you control the user's desktop like a keyboard and mouse.

Workflow:
1. \`computer_list_windows\` — see which windows are open and get their titles
2. \`computer_screenshot\` — capture the screen (omit \`windowTitle\` for full screen, or specify one to focus that window)
3. \`computer_click\` / \`computer_type\` / \`computer_press_key\` / \`computer_move_mouse\` / \`computer_scroll\` / \`computer_drag\` — interact with the desktop

Coordinates are pixel-based starting from the top-left of the primary display. Always call \`computer_screenshot\` first to see the current screen state before interacting.

If a tool returns \`"permissionRequired"\`, it means you don't have access — wait for the user to approve it in the permission widget.${memorySection}
```

The full end of the function should be:
```typescript
## Computer Use

You have access to computer_* tools that let you control the user's desktop like a keyboard and mouse.

Workflow:
1. \`computer_list_windows\` — see which windows are open and get their titles
2. \`computer_screenshot\` — capture the screen (omit \`windowTitle\` for full screen, or specify one to focus that window)
3. \`computer_click\` / \`computer_type\` / \`computer_press_key\` / \`computer_move_mouse\` / \`computer_scroll\` / \`computer_drag\` — interact with the desktop

Coordinates are pixel-based starting from the top-left of the primary display. Always call \`computer_screenshot\` first to see the current screen state before interacting.

If a tool returns \`"permissionRequired"\`, it means you don't have access — wait for the user to approve it in the permission widget.${memorySection}
```

Change the last line of `buildSystemPrompt` (currently ends with `${memorySection}`) to end with the new section above plus memory.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/agent.ts lib/agent/system-prompt.ts
git commit -m "feat: inject computer tools in agent when model supports images"
```

---

### Task 6: Create computer-tool-ui.tsx + register

**Files:**
- Create: `components/assistant-ui/tools/computer-tool-ui.tsx`
- Modify: `components/assistant-ui/tools/index.ts`
- Modify: `components/assistant-ui/agent-runtime-provider.tsx`

- [ ] **Step 1: Create components/assistant-ui/tools/computer-tool-ui.tsx**

```typescript
"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const ComputerScreenshotToolUI: ToolCallMessagePartComponent = ({ args, result }) => {
  const windowTitle = (args as any)?.windowTitle;
  let imageSrc = "";
  try {
    const data = typeof result === "string" ? JSON.parse(result) : result;
    if (data?.base64) imageSrc = `data:image/png;base64,${data.base64}`;
  } catch {}

  return (
    <div className="my-2 rounded-xl border border-border/60 overflow-hidden">
      <div className="bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground font-medium flex items-center gap-2">
        <span>📷 Screenshot</span>
        {windowTitle && <span className="text-muted-foreground/60">— {windowTitle}</span>}
      </div>
      {imageSrc ? (
        <img src={imageSrc} alt="Screenshot" className="w-full h-auto" />
      ) : (
        <div className="px-3 py-4 text-xs text-muted-foreground/60 text-center">
          Screenshot captured ({result ? "success" : "pending"})
        </div>
      )}
    </div>
  );
};

export const ComputerToolUI: ToolCallMessagePartComponent = ({ toolName, args, result }) => {
  const name = toolName.replace("computer_", "").replace(/_/g, " ");
  const a = args as Record<string, unknown> || {};
  const detailLines: string[] = [];
  if (a.x !== undefined && a.y !== undefined) detailLines.push(`(${a.x}, ${a.y})`);
  if (a.text) detailLines.push(`"${(a.text as string).slice(0, 50)}"`);
  if (a.keys) detailLines.push(`[${a.keys}]`);
  if (a.button && a.button !== "left") detailLines.push(`button: ${a.button}`);
  if (a.direction) detailLines.push(`${a.direction} x${a.amount || 1}`);
  if (a.fromX !== undefined) detailLines.push(`${a.fromX},${a.fromY} → ${a.toX},${a.toY}`);

  return (
    <div className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-md uppercase tracking-wider">
        {name}
      </span>
      {detailLines.length > 0 && (
        <span className="truncate">{detailLines.join(" | ")}</span>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Add exports to tools/index.ts**

```typescript
export { ComputerScreenshotToolUI, ComputerToolUI } from "./computer-tool-ui";
```

- [ ] **Step 3: Register in agent-runtime-provider.tsx**

Add imports:
```typescript
import {
  ComputerScreenshotToolUI,
  ComputerToolUI,
} from "@/components/assistant-ui/tools";
```

Add registrations in `ToolUIRegistrar`:
```typescript
  useAssistantToolUI({ toolName: "computer_screenshot", render: ComputerScreenshotToolUI });
  useAssistantToolUI({ toolName: "computer_click", render: ComputerToolUI });
  useAssistantToolUI({ toolName: "computer_type", render: ComputerToolUI });
  useAssistantToolUI({ toolName: "computer_press_key", render: ComputerToolUI });
  useAssistantToolUI({ toolName: "computer_move_mouse", render: ComputerToolUI });
  useAssistantToolUI({ toolName: "computer_scroll", render: ComputerToolUI });
  useAssistantToolUI({ toolName: "computer_drag", render: ComputerToolUI });
  useAssistantToolUI({ toolName: "computer_list_windows", render: ComputerToolUI });
```

- [ ] **Step 4: Commit**

```bash
git add components/assistant-ui/tools/computer-tool-ui.tsx components/assistant-ui/tools/index.ts components/assistant-ui/agent-runtime-provider.tsx
git commit -m "feat: add computer-tool-ui and register in agent runtime"
```

---

### Task 7: Add Computer Use section to settings dialog

**Files:**
- Modify: `components/shared/settings-dialog.tsx`

- [ ] **Step 1: Add Computer Use section in the Advanced tab**

Find the Advanced tab content (the `<TabsContent value="advanced">` block). After the "Custom Instructions" section and before "Startup & Background", add:

```tsx
                {/* Computer Use Section */}
                <div className="border-t border-border/40 pt-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Computer Use</h3>
                      <p className="text-xs text-muted-foreground">
                        Let the agent control your keyboard and mouse to interact with applications.
                        {(() => {
                          const curModel = localStorage.getItem("qube-default-model") || "";
                          const colonIdx = curModel.indexOf(":");
                          const modelId = colonIdx >= 0 ? curModel.slice(colonIdx + 1) : curModel;
                          if (modelId && !detectModelImageSupport(modelId)) {
                            return " Requires a model with image input support.";
                          }
                          return "";
                        })()}
                      </p>
                    </div>
                    <SwitchToggle
                      checked={computerUseEnabled}
                      onCheckedChange={(v) => {
                        setComputerUseEnabled(v);
                        localStorage.setItem("qube-computer-use-enabled", String(v));
                        fetch("/api/computer/settings", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ settings: { enabled: v } }),
                        }).catch(() => {});
                      }}
                    />
                  </div>

                  {computerUseEnabled && (
                    <div className="space-y-4 pl-1">
                      {/* Full Screen toggle */}
                      <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-border/60 bg-muted/10">
                        <div className="space-y-0.5">
                          <span className="text-sm font-medium text-foreground">Full Screen</span>
                          <p className="text-xs text-muted-foreground">
                            Grant access to the entire screen without requiring permission prompts.
                          </p>
                        </div>
                        <SwitchToggle
                          checked={computerUseFullScreen}
                          onCheckedChange={(v) => {
                            setComputerUseFullScreen(v);
                            localStorage.setItem("qube-computer-use-fullscreen", String(v));
                            fetch("/api/computer/settings", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ settings: { fullScreen: v } }),
                            }).catch(() => {});
                          }}
                        />
                      </div>

                      {/* Managed Apps */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">Managed Apps</span>
                          <Button
                            onClick={fetchRunningApps}
                            variant="outline"
                            className="rounded-full font-semibold px-3 h-7 text-xs flex items-center gap-1"
                            size="sm"
                          >
                            <PlusIcon className="size-3" />
                            Add App
                          </Button>
                        </div>

                        {computerUseApps.length === 0 ? (
                          <p className="text-xs text-muted-foreground/60 italic px-1">
                            No apps configured. Click "Add App" to allow the agent to control a specific application by its window title.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {computerUseApps.map((app) => (
                              <div
                                key={app.id}
                                className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-border/60 bg-muted/10"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-foreground truncate">{app.titlePattern}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <SwitchToggle
                                    checked={app.enabled}
                                    onCheckedChange={(checked) => {
                                      const updated = computerUseApps.map((a) =>
                                        a.id === app.id ? { ...a, enabled: checked } : a,
                                      );
                                      setComputerUseApps(updated);
                                      localStorage.setItem("qube-computer-use-apps", JSON.stringify(updated));
                                      fetch("/api/computer/settings", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          settings: {
                                            allowedApps: updated.map((a) => ({
                                              id: a.id,
                                              titlePattern: a.titlePattern,
                                              enabled: a.enabled,
                                            })),
                                          },
                                        }),
                                      }).catch(() => {});
                                    }}
                                  />
                                  <button
                                    onClick={() => {
                                      const updated = computerUseApps.filter((a) => a.id !== app.id);
                                      setComputerUseApps(updated);
                                      localStorage.setItem("qube-computer-use-apps", JSON.stringify(updated));
                                      fetch("/api/computer/settings", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          settings: {
                                            allowedApps: updated.map((a) => ({
                                              id: a.id,
                                              titlePattern: a.titlePattern,
                                              enabled: a.enabled,
                                            })),
                                          },
                                        }),
                                      }).catch(() => {});
                                    }}
                                    className="size-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors cursor-pointer"
                                    title="Remove app"
                                  >
                                    <Trash2Icon className="size-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
```

- [ ] **Step 2: Add state variables for computer use**

In the `SettingsDialog` function, after the advanced settings state (`runOnStart`, `keepAlive`), add:

```typescript
  // Computer Use state
  const [computerUseEnabled, setComputerUseEnabled] = useState(false);
  const [computerUseFullScreen, setComputerUseFullScreen] = useState(false);
  const [computerUseApps, setComputerUseApps] = useState<Array<{ id: string; titlePattern: string; enabled: boolean }>>([]);
  const [runningApps, setRunningApps] = useState<Array<{ title: string; pid: number }>>([]);
  const [addAppOpen, setAddAppOpen] = useState(false);
  const [customAppTitle, setCustomAppTitle] = useState("");
```

- [ ] **Step 3: Add fetchRunningApps and load computer use settings on dialog open**

Add the `fetchRunningApps` function:
```typescript
  const fetchRunningApps = useCallback(async () => {
    try {
      const res = await fetch("/api/computer/available-apps");
      if (res.ok) {
        const data = await res.json();
        setRunningApps(data.windows || []);
        setAddAppOpen(true);
      }
    } catch {}
  }, []);
```

In the load useEffect (where localStorage values are read), add loading of computer use settings:
```typescript
      setComputerUseEnabled(localStorage.getItem("qube-computer-use-enabled") === "true");
      setComputerUseFullScreen(localStorage.getItem("qube-computer-use-fullscreen") === "true");
      const storedApps = localStorage.getItem("qube-computer-use-apps");
      if (storedApps) {
        try { setComputerUseApps(JSON.parse(storedApps)); } catch {}
      }
```

And after the server-settings fetch, add loading computer use settings from server:
```typescript
      // Load computer use settings from server
      try {
        const res = await fetch("/api/computer/settings");
        if (res.ok) {
          const data = await res.json();
          const cs = data.settings;
          if (cs) {
            if (!localStorage.getItem("qube-computer-use-enabled") && cs.enabled !== undefined) {
              setComputerUseEnabled(cs.enabled);
            }
            if (!localStorage.getItem("qube-computer-use-fullscreen") && cs.fullScreen !== undefined) {
              setComputerUseFullScreen(cs.fullScreen);
            }
            if (!localStorage.getItem("qube-computer-use-apps") && cs.allowedApps?.length) {
              setComputerUseApps(cs.allowedApps);
            }
          }
        }
      } catch {}
```

- [ ] **Step 4: Add the Add App dialog**

After the Custom Instructions dialog (the last `</Dialog>` before the `</>`), add:

```tsx
      {/* Add App Dialog */}
      <Dialog open={addAppOpen} onOpenChange={setAddAppOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Add Application</DialogTitle>
            <DialogDescription>
              Select a running application or type a window title pattern to allow the agent to control it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Custom Title Pattern</label>
              <input
                type="text"
                placeholder="e.g. Firefox, Terminal, Visual Studio Code..."
                value={customAppTitle}
                onChange={(e) => setCustomAppTitle(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="border-t border-border/40 pt-3">
              <p className="text-xs text-muted-foreground font-medium mb-2">Running Applications</p>
              <div className="max-h-[250px] overflow-y-auto space-y-1 pr-1">
                {runningApps.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 italic py-4 text-center">
                    No running windows detected.
                  </p>
                ) : (
                  runningApps.map((w, i) => (
                    <button
                      key={`${w.title}-${i}`}
                      type="button"
                      onClick={() => {
                        const id = `app_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                        const newApp = { id, titlePattern: w.title, enabled: true };
                        const updated = [...computerUseApps, newApp];
                        setComputerUseApps(updated);
                        localStorage.setItem("qube-computer-use-apps", JSON.stringify(updated));
                        fetch("/api/computer/settings", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            settings: {
                              allowedApps: updated.map((a) => ({
                                id: a.id,
                                titlePattern: a.titlePattern,
                                enabled: a.enabled,
                              })),
                            },
                          }),
                        }).catch(() => {});
                        setAddAppOpen(false);
                        setCustomAppTitle("");
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-muted/30 transition-colors border border-transparent hover:border-border/60"
                    >
                      <p className="font-medium truncate">{w.title}</p>
                      <p className="text-[10px] text-muted-foreground/60">PID: {w.pid}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <div className="flex items-center gap-2 w-full justify-end">
              <Button variant="outline" onClick={() => { setAddAppOpen(false); setCustomAppTitle(""); }} className="rounded-full h-8 px-4">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!customAppTitle.trim()) return;
                  const id = `app_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                  const newApp = { id, titlePattern: customAppTitle.trim(), enabled: true };
                  const updated = [...computerUseApps, newApp];
                  setComputerUseApps(updated);
                  localStorage.setItem("qube-computer-use-apps", JSON.stringify(updated));
                  fetch("/api/computer/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      settings: {
                        allowedApps: updated.map((a) => ({
                          id: a.id,
                          titlePattern: a.titlePattern,
                          enabled: a.enabled,
                        })),
                      },
                    }),
                  }).catch(() => {});
                  setAddAppOpen(false);
                  setCustomAppTitle("");
                }}
                disabled={!customAppTitle.trim()}
                className="rounded-full font-semibold h-8 px-4"
                size="sm"
              >
                Add
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Commit**

```bash
git add components/shared/settings-dialog.tsx
git commit -m "feat: add Computer Use section in Advanced settings with app management"
```

---

### Task 8: Add image-input gate check in settings dialog

**Files:**
- Modify: `components/shared/settings-dialog.tsx`

The Computer Use section already has an inline check that hides itself when the model doesn't support images. But the section is always rendered (just with a note in the description). The user said "only image capable models can use them" — so the section should be **hidden entirely** when the model doesn't support images.

- [ ] **Step 1: Hide Computer Use section when model lacks image support**

Wrap the entire Computer Use section block (from `<div className="border-t border-border/40 pt-6 space-y-4">` through the closing `</div>` before "Startup & Background") with:

```tsx
{(() => {
  const curModel = typeof window !== "undefined" ? localStorage.getItem("qube-default-model") || "" : "";
  const colonIdx = curModel.indexOf(":");
  const modelId = colonIdx >= 0 ? curModel.slice(colonIdx + 1) : curModel;
  if (!modelId || !detectModelImageSupport(modelId)) return null;
  return (
    // ... Computer Use section content ...
  );
})()}
```

- [ ] **Step 2: Commit**

```bash
git add components/shared/settings-dialog.tsx
git commit -m "feat: hide computer use section for models without image input"
```
