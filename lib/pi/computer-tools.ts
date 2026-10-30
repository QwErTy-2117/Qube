/**
 * Computer Use tools — OS-level control via CUA Driver (trycua/cua).
 *
 * Qube-facing names are preserved (`computer_list_apps`, `computer_click`, …)
 * so the agent's existing habits keep working, while every call now goes
 * through the CUA Driver integration in `lib/cua/*`. The model never touches
 * the OS directly.
 *
 * Safety:
 * - Read-only tools (list/get/doctor/capabilities/clipboard_read) run without
 *   pausing.
 * - Mutating tools go through withPermissionCheck in interactive sessions, so
 *   the chat blocks on the approval card. Background runs refuse mutations
 *   instead of acting blindly. A `computer_run_sequence` whose calls are all
 *   read-only is allowed in background too.
 */

import { tool } from "ai";
import { z } from "zod";

import {
  cuaErrorPayload,
  CuaDriverError,
  isLegacyObservationTool,
  validateSequenceCalls,
  LEGACY_SEQUENCE_TOOLS,
} from "@/lib/cua";
import { CuaService } from "@/lib/cua/service";
import type { CuaActionResult } from "@/lib/cua";

export type ComputerToolsOptions = {
  /** Foreground chat passes true (default); subagents/scheduler pass false. */
  includeAskUser?: boolean;
};

const labelField = z
  .string()
  .optional()
  .describe("Short playful label for the activity card (e.g. 'Opening Notes')");

const elementIndexField = z
  .union([z.string(), z.number()])
  .optional()
  .describe("Element index from computer_get_app_state (e.g. 12 or \"[12]\")");

const elementTokenField = z
  .string()
  .optional()
  .describe("Element token from computer_get_app_state (sXXXXXXXX:12)");

const targetFields = {
  app: z.string().optional().describe("App name or bundle id from computer_list_apps"),
  pid: z.number().optional().describe("Process id (alternative to app)"),
  window_id: z.number().optional().describe("Window id from computer_list_windows"),
  window: z.string().optional().describe("Window title substring"),
};

const deliveryField = z
  .enum(["background", "foreground"])
  .optional()
  .describe(
    "background never activates the window; foreground briefly focuses it when the app refuses background input",
  );

function cleanArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  const { label: _label, verify: _verify, ...rest } = args;
  void _label;
  void _verify;
  return rest;
}

function compactResult(
  toolName: string,
  result: CuaActionResult,
  extra: Record<string, unknown> = {},
): string {
  const data = { ...(result.data ?? {}) };
  delete (data as Record<string, unknown>).screenshot_png_b64;
  delete (data as Record<string, unknown>).elements;
  const payload: Record<string, unknown> = {
    ok: true,
    tool: toolName,
    ...data,
    ...extra,
  };
  if (result.text && !payload.text) payload.text = result.text.slice(0, 8000);
  return JSON.stringify(payload).slice(0, 16000);
}

function backgroundRefusal(toolName: string): string {
  return JSON.stringify({
    error: true,
    tool: toolName,
    available: false,
    code: "background_unavailable",
    message:
      "Computer control needs an interactive user to approve it. Background runs cannot click/type/press keys. Return read-only findings (list_apps/get_app_state) and leave actions for the foreground chat.",
  });
}

export function createComputerTools(threadId: string, opts?: ComputerToolsOptions) {
  const interactive = opts?.includeAskUser !== false;
  const service = new CuaService(threadId);

  const safe = async (toolName: string, run: () => Promise<string>): Promise<string> => {
    try {
      return await run();
    } catch (error) {
      return cuaErrorPayload(toolName, error);
    }
  };

  const gate = async (
    qubeTool: string,
    args: Record<string, unknown>,
    run: () => Promise<string>,
  ): Promise<string> => {
    if (!interactive) return backgroundRefusal(qubeTool);
    try {
      const { withPermissionCheck } = await import("@/lib/middleware/permission-middleware");
      return await withPermissionCheck(qubeTool, args, threadId, run);
    } catch {
      return await run();
    }
  };

  const observe = (raw: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const args = cleanArgs(raw);
    return service.observeWindow({
      pid: typeof args.pid === "number" ? args.pid : undefined,
      window_id: typeof args.window_id === "number" ? args.window_id : undefined,
      app: typeof args.app === "string" ? args.app : undefined,
      window: typeof args.window === "string" ? args.window : undefined,
      max_elements:
        typeof args.max_tree_nodes === "number"
          ? args.max_tree_nodes
          : typeof args.max_elements === "number"
            ? args.max_elements
            : undefined,
      max_depth:
        typeof args.max_tree_depth === "number"
          ? args.max_tree_depth
          : typeof args.max_depth === "number"
            ? args.max_depth
            : undefined,
      query: typeof args.query === "string" ? args.query : undefined,
      ...extra,
    });
  };

  return {
    computer_list_apps: tool({
      description:
        "List running and recently used OS apps with pids and window counts (CUA Driver list_apps). Call BEFORE a computer action when you need an exact app name. Read-only, no approval needed.",
      inputSchema: z.object({ label: labelField }).passthrough(),
      execute: async () =>
        safe("computer_list_apps", async () => {
          const apps = await service.listApps();
          const compact = apps.slice(0, 250).map((app) => ({
            name: app.name,
            pid: app.pid,
            running: app.running,
            active: app.active,
            windows: Array.isArray(app.windows) ? app.windows.length : 0,
          }));
          return JSON.stringify({
            ok: true,
            apps: compact,
            count: apps.length,
            rendered: service.renderApps(apps),
          }).slice(0, 16000);
        }),
    }),

    computer_list_windows: tool({
      description:
        "List OS windows, optionally filtered by app or pid (CUA Driver list_windows). Read-only. Use exact window_id values when an app has multiple windows.",
      inputSchema: z
        .object({
          ...targetFields,
          on_screen_only: z.boolean().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        safe("computer_list_windows", async () => {
          const args = cleanArgs(raw);
          const target = await service
            .resolveTarget(args, { fallbackLast: false })
            .catch(() => null);
          const windows = await service.listWindows({
            pid: target?.pid ?? (typeof args.pid === "number" ? args.pid : undefined),
            app: target?.app ?? (typeof args.app === "string" ? args.app : undefined),
            on_screen_only: args.on_screen_only === true,
          });
          return JSON.stringify({
            ok: true,
            windows: windows.slice(0, 250),
            count: windows.length,
            rendered: service.renderWindows(windows),
          }).slice(0, 20000);
        }),
    }),

    computer_get_window: tool({
      description:
        "Get one OS window's metadata (pid, window_id, title, bounds) by app/pid/window_id. Read-only; use computer_get_app_state when you need the accessibility tree.",
      inputSchema: z.object({ ...targetFields, label: labelField }).passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        safe("computer_get_window", async () => {
          const got = await service.getWindow(cleanArgs(raw));
          return JSON.stringify({
            ok: true,
            window: got.window,
            windows: got.windows.slice(0, 100),
            rendered: service.renderWindows(got.windows),
          }).slice(0, 16000);
        }),
    }),

    computer_get_app_state: tool({
      description:
        "Read an OS app's accessibility tree + screenshot (CUA Driver get_window_state). Returns element indexes/tokens and the exact window-local screenshot pixels used by actions. Read-only, no approval needed. Re-read after navigation, modals, or failures — indexes can go stale after the UI changes.",
      inputSchema: z
        .object({
          ...targetFields,
          text_limit: z.union([z.number(), z.string()]).optional(),
          max_tree_nodes: z.number().optional(),
          max_tree_depth: z.number().optional(),
          query: z.string().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        safe("computer_get_app_state", async () => service.renderObservation(await observe(raw))),
    }),

    computer_get_window_state: tool({
      description:
        "Read one exact window's accessibility tree + screenshot (alias of computer_get_app_state with explicit window_id). Read-only.",
      inputSchema: z
        .object({
          ...targetFields,
          max_elements: z.number().optional(),
          max_depth: z.number().optional(),
          query: z.string().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        safe("computer_get_window_state", async () => service.renderObservation(await observe(raw))),
    }),

    computer_get_desktop_state: tool({
      description:
        "Capture the whole desktop (CUA Driver get_desktop_state) and return its screenshot dimensions. Use desktop x/y only when an app window cannot be targeted; window screenshots are safer. Read-only.",
      inputSchema: z
        .object({
          max_image_dimension: z.number().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        safe("computer_get_desktop_state", async () => {
          const args = cleanArgs(raw);
          const obs = await service.observeDesktop({
            max_image_dimension:
              typeof args.max_image_dimension === "number" ? args.max_image_dimension : undefined,
          });
          return JSON.stringify({
            ok: true,
            scope: "desktop",
            width: obs.width,
            height: obs.height,
            hint: 'Pass scope:"desktop" with x/y when acting on desktop coordinates.',
          });
        }),
    }),

    computer_click: tool({
      description:
        "Click an OS app element by element_index/element_token from computer_get_app_state, or by window-local screenshot x/y. Read the app state immediately before element actions and re-read after the UI changes. Needs user approval in chat. Set verify:true to re-read the window after the click and confirm something changed.",
      inputSchema: z
        .object({
          ...targetFields,
          element_index: elementIndexField,
          element_token: elementTokenField,
          x: z.number().optional().describe("Window-local screenshot pixel X"),
          y: z.number().optional().describe("Window-local screenshot pixel Y"),
          button: z.string().optional().describe("left (default), right, or middle"),
          count: z.number().optional().describe("Click count 1-3"),
          modifier: z.array(z.string()).optional(),
          delivery_mode: deliveryField,
          scope: z.enum(["window", "desktop"]).optional(),
          verify: z.boolean().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_click", raw ?? {}, async () => {
          const args = cleanArgs(raw);
          const before = raw?.verify ? service.cachedObservationText(args) : "";
          const result = await service.click(args);
          if (raw?.verify) {
            try {
              const after = await observe({
                app: args.app,
                pid: args.pid,
                window_id: args.window_id,
                window: args.window,
              });
              const changed = !before || after.text !== before;
              return JSON.stringify({
                ok: true,
                tool: "computer_click",
                verified: before ? (changed ? "screen-changed" : "unchanged") : "unavailable",
                ...(before && !changed
                  ? {
                      warning: "click sent but the window tree looks unchanged",
                      hint: "Re-ground from a fresh computer_get_app_state and retry once with a different target or method.",
                    }
                  : {}),
                click: result.data ?? {},
              }).slice(0, 12000);
            } catch {}
          }
          return compactResult("computer_click", result);
        }),
    }),

    computer_secondary_action: tool({
      description:
        "Right-click an OS app element (CUA Driver right_click) by element_index/element_token, or by x/y. Use for context menus and alternate actions. Needs user approval in chat.",
      inputSchema: z
        .object({
          ...targetFields,
          element_index: elementIndexField,
          element_token: elementTokenField,
          x: z.number().optional(),
          y: z.number().optional(),
          delivery_mode: deliveryField,
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_secondary_action", raw ?? {}, async () =>
          compactResult(
            "computer_secondary_action",
            await service.click(cleanArgs(raw), { button: "right" }),
          ),
        ),
    }),

    computer_scroll: tool({
      description:
        "Scroll an OS app element or window (CUA Driver scroll). Use direction + pages/amount, or delta_x/delta_y. Window-local x/y are optional. Needs user approval in chat.",
      inputSchema: z
        .object({
          ...targetFields,
          element_index: elementIndexField,
          element_token: elementTokenField,
          direction: z.string().optional().describe("up, down, left, or right"),
          pages: z.number().optional(),
          delta_x: z.number().optional(),
          delta_y: z.number().optional(),
          amount: z.number().optional(),
          by: z.enum(["line", "page"]).optional(),
          x: z.number().optional(),
          y: z.number().optional(),
          delivery_mode: deliveryField,
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_scroll", raw ?? {}, async () =>
          compactResult("computer_scroll", await service.scroll(cleanArgs(raw))),
        ),
    }),

    computer_drag: tool({
      description:
        "Drag between two window-local screenshot points (CUA Driver drag). Pass from_x/from_y + to_x/to_y (start_x/start_y + end_x/end_y also accepted). Needs user approval in chat.",
      inputSchema: z
        .object({
          ...targetFields,
          from_x: z.number().optional(),
          from_y: z.number().optional(),
          to_x: z.number().optional(),
          to_y: z.number().optional(),
          start_x: z.number().optional(),
          start_y: z.number().optional(),
          end_x: z.number().optional(),
          end_y: z.number().optional(),
          duration_ms: z.number().optional(),
          button: z.string().optional(),
          delivery_mode: deliveryField,
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_drag", raw ?? {}, async () =>
          compactResult("computer_drag", await service.drag(cleanArgs(raw))),
        ),
    }),

    computer_type_text: tool({
      description:
        "Type text into an OS app (CUA Driver type_text). Prefer set_value for settable controls. Target an element_index/token or x/y; text is Unicode-safe. Needs user approval in chat.",
      inputSchema: z
        .object({
          ...targetFields,
          text: z.string().describe("Text to type"),
          element_index: elementIndexField,
          element_token: elementTokenField,
          x: z.number().optional(),
          y: z.number().optional(),
          delivery_mode: deliveryField,
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_type_text", raw ?? {}, async () =>
          compactResult("computer_type_text", await service.typeText(cleanArgs(raw))),
        ),
    }),

    computer_press_key: tool({
      description:
        "Press a key or chord in an OS app (CUA Driver press_key/hotkey): return, escape, tab, page_up, ctrl+s, cmd+shift+t. Target an element_index/token or x/y when focus is ambiguous. Needs user approval in chat.",
      inputSchema: z
        .object({
          ...targetFields,
          key: z.string().optional().describe("Key or chord, e.g. 'return' or 'ctrl+s'"),
          keys: z.array(z.string()).optional().describe("Explicit chord, e.g. ['ctrl','s']"),
          modifiers: z.array(z.string()).optional(),
          element_index: elementIndexField,
          element_token: elementTokenField,
          x: z.number().optional(),
          y: z.number().optional(),
          delivery_mode: deliveryField,
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_press_key", raw ?? {}, async () =>
          compactResult("computer_press_key", await service.pressKey(cleanArgs(raw))),
        ),
    }),

    computer_set_value: tool({
      description:
        "Set an OS control's value directly (CUA Driver set_value): text fields, search boxes, sliders. Needs an element_index/element_token from a fresh app state, and is usually more reliable than typing. Needs user approval in chat.",
      inputSchema: z
        .object({
          ...targetFields,
          element_index: elementIndexField,
          element_token: elementTokenField,
          value: z.string().describe("New value"),
          delivery_mode: deliveryField,
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_set_value", raw ?? {}, async () =>
          compactResult("computer_set_value", await service.setValue(cleanArgs(raw))),
        ),
    }),

    computer_launch_app: tool({
      description:
        "Launch an OS app by exact name (CUA Driver launch_app) and briefly verify that a window appears. Use computer_list_apps for the name. Needs user approval in chat.",
      inputSchema: z
        .object({
          app: z.string().optional(),
          name: z.string().optional(),
          bundle_id: z.string().optional(),
          launch_path: z.string().optional(),
          urls: z.array(z.string()).optional(),
          additional_arguments: z.array(z.string()).optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_launch_app", raw ?? {}, async () => {
          const result = await service.launchApp(cleanArgs(raw));
          return JSON.stringify({
            ok: true,
            tool: "computer_launch_app",
            launched: result.data,
            windows: result.windows,
            rendered: service.renderWindows(result.windows),
            ...(result.windows.length === 0
              ? {
                  hint: "Launch was accepted but no window appeared yet. Wait a moment, then call computer_list_windows or computer_get_app_state.",
                }
              : {}),
          }).slice(0, 16000);
        }),
    }),

    computer_activate_window: tool({
      description:
        "Bring one OS app window to the front (CUA Driver bring_to_front) by app/pid/window_id. Needs user approval in chat.",
      inputSchema: z.object({ ...targetFields, label: labelField }).passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_activate_window", raw ?? {}, async () => {
          const result = await service.activateWindow(cleanArgs(raw));
          return JSON.stringify({
            ok: true,
            tool: "computer_activate_window",
            activated: result.data,
            window: result.window,
          }).slice(0, 12000);
        }),
    }),

    computer_doctor: tool({
      description:
        "Check CUA Driver install, daemon, and desktop permissions (`cua-driver doctor`). Read-only, no approval needed.",
      inputSchema: z.object({ label: labelField }).passthrough(),
      execute: async () =>
        safe("computer_doctor", async () => {
          const result = await service.doctor();
          return JSON.stringify({
            ok: true,
            ...(result.data ?? {}),
            raw: result.raw.slice(0, 12000),
          }).slice(0, 18000);
        }),
    }),

    computer_clipboard_read: tool({
      description:
        "Read the OS clipboard text and available types (CUA Driver clipboard_read). Read-only, no approval needed.",
      inputSchema: z.object({ label: labelField }).passthrough(),
      execute: async () =>
        safe("computer_clipboard_read", async () =>
          compactResult("computer_clipboard_read", await service.clipboardRead()),
        ),
    }),

    computer_clipboard_write: tool({
      description:
        "Write text to the OS clipboard (CUA Driver clipboard_write). Use to hand links, code, or results to the user for pasting elsewhere. Needs user approval in chat.",
      inputSchema: z
        .object({
          text: z.string().describe("Text to put on the clipboard"),
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        gate("computer_clipboard_write", raw ?? {}, async () =>
          compactResult("computer_clipboard_write", await service.clipboardWrite(cleanArgs(raw))),
        ),
    }),

    computer_capabilities: tool({
      description:
        "Inspect the local CUA Driver runtime: daemon, session, platform, display, cursor config, and available tools. Read-only, no approval needed.",
      inputSchema: z.object({ label: labelField }).passthrough(),
      execute: async () =>
        safe("computer_capabilities", async () =>
          JSON.stringify(await service.capabilities()).slice(0, 20000),
        ),
    }),

    computer_run_sequence: tool({
      description:
        "PREFERRED way to act on OS apps: batch observe + actions in one CUA Driver run_steps call. Start with get_app_state for the app, then element actions using that call's indexes, or pass app once and use role/name targeting in later steps. Reads and actions run in order; the result includes a post-action observation. Needs user approval in chat unless every step is read-only.",
      inputSchema: z
        .object({
          calls: z
            .array(
              z.object({
                tool: z.enum(LEGACY_SEQUENCE_TOOLS as unknown as [string, ...string[]]),
                args: z.record(z.string(), z.any()),
              }),
            )
            .min(1)
            .max(16)
            .optional()
            .describe("Ordered legacy steps: get_app_state first, then actions"),
          steps: z
            .array(z.record(z.string(), z.any()))
            .max(64)
            .optional()
            .describe("Raw CUA run_steps steps (advanced; alternative to calls)"),
          sleep: z.number().optional().describe("Seconds between successful steps (max 2)"),
          observe: z
            .boolean()
            .optional()
            .describe("Capture a post-action screenshot + tree (default true)"),
          app: z.string().optional(),
          window: z.string().optional(),
          label: labelField,
        })
        .passthrough(),
      execute: async (raw: Record<string, unknown>) =>
        safe("computer_run_sequence", async () => {
          const args = cleanArgs(raw);
          if (Array.isArray(args.calls)) {
            const validated = validateSequenceCalls(args.calls);
            if (!validated.ok) {
              throw new CuaDriverError(
                validated.error,
                "invalid_args",
                "Use calls:[{tool,args}, …] with get_app_state first.",
              );
            }
            const allReadOnly = validated.calls.every((call) => isLegacyObservationTool(call.tool));
            const run = () =>
              service.runSequence({
                ...args,
                calls: validated.calls,
              });
            if (allReadOnly) return run();
            return gate("computer_run_sequence", raw ?? {}, run);
          }
          if (Array.isArray(args.steps)) {
            return gate("computer_run_sequence", raw ?? {}, () =>
              service.runSequence({ ...args, steps: args.steps }),
            );
          }
          throw new CuaDriverError(
            "computer_run_sequence needs calls or steps.",
            "invalid_args",
            "Pass calls:[{tool,args}, …].",
          );
        }),
    }),
  };
}
