import { tool } from "ai";
import { z } from "zod";
import { computerManager } from "./computer-manager";
const screenBoundsSchema = z.object({
  width: z.number().min(1).max(99999).default(1920),
  height: z.number().min(1).max(99999).default(1080),
});

const coordinateSchema = z.object({
  x: z.number().min(0).describe("X coordinate (0 = left edge)"),
  y: z.number().min(0).describe("Y coordinate (0 = top edge)"),
});

export function createComputerTools(threadId: string) {
  const handleError = (error: unknown): string => {
    const msg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: true, message: msg });
  };

  return {
    computer_screenshot: tool({
      description: `Take a screenshot of the screen or a specific window. Returns a base64 PNG image with dimensions.
Use this to see what's on screen before taking actions. Always call this first.`,
      inputSchema: z.object({
        label: z.string().optional(),
        windowTitle: z.string().optional().describe("Optional window title to focus before capture"),
        ...screenBoundsSchema.shape,
      }),
      execute: async ({ windowTitle }: { windowTitle?: string; width: number; height: number }) => {
        try {
          const result = await computerManager.screenshot(windowTitle);
          return JSON.stringify(result);
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    computer_click: tool({
      description: "Click at a specific screen coordinate. Supports left, right, and middle buttons.",
      inputSchema: z.object({
        label: z.string().optional(),
        ...coordinateSchema.shape,
        button: z.enum(["left", "right", "middle"]).default("left"),
      }),
      execute: async ({ x, y, button }: { x: number; y: number; button: "left" | "right" | "middle" }) => {
        try {
          await computerManager.click(x, y, button);
          return JSON.stringify({ success: true, x, y, button });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    computer_type: tool({
      description: "Type text at the current cursor position. Use for filling forms, entering commands, or writing text.",
      inputSchema: z.object({
        label: z.string().optional(),
        text: z.string().describe("The text to type. Use \\n for newlines."),
      }),
      execute: async ({ text }: { text: string }) => {
        try {
          const resolved = text.replace(/\\n/g, "\n");
          await computerManager.type(resolved);
          return JSON.stringify({ success: true, chars: resolved.length });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    computer_press_key: tool({
      description: "Press a key or key combination (e.g. 'ctrl+c', 'enter', 'alt+tab', 'escape').",
      inputSchema: z.object({
        label: z.string().optional(),
        keys: z.string().describe("Key or key combination separated by +. Examples: 'enter', 'ctrl+c', 'alt+tab', 'escape', 'shift+delete'."),
      }),
      execute: async ({ keys }: { keys: string }) => {
        try {
          await computerManager.pressKey(keys);
          return JSON.stringify({ success: true, keys });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    computer_move_mouse: tool({
      description: "Move the mouse cursor to a specific screen coordinate without clicking.",
      inputSchema: z.object({
        label: z.string().optional(),
        ...coordinateSchema.shape,
      }),
      execute: async ({ x, y }: { x: number; y: number }) => {
        try {
          await computerManager.moveMouse(x, y);
          return JSON.stringify({ success: true, x, y });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    computer_scroll: tool({
      description: "Scroll at a specific screen coordinate. Direction can be 'up', 'down', 'left', or 'right'.",
      inputSchema: z.object({
        label: z.string().optional(),
        ...coordinateSchema.shape,
        direction: z.enum(["up", "down", "left", "right"]).describe("Direction to scroll"),
        amount: z.number().min(1).max(100).default(5).describe("Number of scroll steps. Each step is one mouse wheel tick."),
      }),
      execute: async ({ x, y, direction, amount }: { x: number; y: number; direction: "up" | "down" | "left" | "right"; amount: number }) => {
        try {
          await computerManager.scroll(x, y, direction, amount);
          return JSON.stringify({ success: true, x, y, direction, amount });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    computer_drag: tool({
      description: "Drag from one coordinate to another. Presses left mouse at the start position and releases at the end.",
      inputSchema: z.object({
        label: z.string().optional(),
        startX: z.number().min(0),
        startY: z.number().min(0),
        endX: z.number().min(0),
        endY: z.number().min(0),
      }),
      execute: async ({ startX, startY, endX, endY }: { startX: number; startY: number; endX: number; endY: number }) => {
        try {
          await computerManager.drag(startX, startY, endX, endY);
          return JSON.stringify({ success: true, from: { x: startX, y: startY }, to: { x: endX, y: endY } });
        } catch (e) {
          return handleError(e);
        }
      },
    }),

    computer_list_windows: tool({
      description: "List all open windows with their titles and PIDs. Use this to find window titles for targeting screenshots or focus commands.",
      inputSchema: z.object({
        label: z.string().optional(),
      }),
      execute: async () => {
        try {
          const windows = await computerManager.listWindows();
          return JSON.stringify({ windows, count: windows.length });
        } catch (e) {
          return handleError(e);
        }
      },
    }),
  };
}
