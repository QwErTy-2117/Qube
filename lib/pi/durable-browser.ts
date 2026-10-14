import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

/**
 * Durable-path browser/computer extension: ports the legacy browser tools
 * (lib/pi/tools.ts browser_* + open_path + dev_server) through the same
 * computer-use kernel pipeline (repeat-guard, risk gating, verify, recover,
 * audit log) used by the legacy harness. The kernel wraps plain `execute`
 * functions, so the durable tools delegate to the legacy implementations
 * rather than duplicating browser logic.
 *
 * Safety: mutating desktop tools refuse headless (the kernel passes
 * interactive:false on this path, so financial/destructive/account/
 * credential/external browser actions are denied with a blocker message).
 * CAPTCHAs/auth walls surface request_takeover hints, never bypasses.
 */

type KernelMod = typeof import("@/lib/computer-use/index");

let kernelToolsCache: { threadId: string; tools: Record<string, { execute: (args: unknown) => Promise<string> }> } | null = null;

async function kernelTool(threadId: string, name: string): Promise<(args: unknown) => Promise<string>> {
  if (!kernelToolsCache || kernelToolsCache.threadId !== threadId) {
    const kernel: KernelMod = await import("@/lib/computer-use/index");
    const { createPiTools } = await import("@/lib/pi/tools");
    const { createComputerTools } = await import("@/lib/pi/computer-tools");
    const raw: Record<string, any> = {
      ...createPiTools(threadId, { includeAskUser: false, includeSubagents: false, includeTodos: false }),
      ...createComputerTools(threadId, { includeAskUser: false }),
    };
    if (kernel.kernelEnabled()) {
      kernel.applyKernel(raw, { threadId, interactive: false });
    }
    const picked: Record<string, { execute: (args: unknown) => Promise<string> }> = {};
    for (const n of ["browser_navigate", "browser_snapshot", "browser_act", "browser_screenshot", "browser_pixel_act", "open_path", "dev_server", "dev_server_log", "request_takeover", "computer_clipboard_read", "computer_clipboard_write"]) {
      const def = raw[n];
      if (def && typeof def.execute === "function") picked[n] = { execute: (args: unknown) => def.execute(args) as Promise<string> };
    }
    kernelToolsCache = { threadId, tools: picked };
  }
  const t = kernelToolsCache.tools[name];
  if (!t) throw new Error(`browser tool ${name} unavailable`);
  return t.execute;
}

function browserTool(name: string, description: string, parameters: unknown, opts?: { replay?: "safe" }) {
  return defineTool({
    name,
    description,
    parameters: parameters as never,
    ...(opts?.replay === "safe" ? { replay: "safe" as const } : {}),
    execute: async (args, api) => {
      try {
        const threadId = String((api as { taskId?: unknown }).taskId || "durable");
        const run = await kernelTool(threadId, name);
        const out = await run(args);
        const text = typeof out === "string" ? out : JSON.stringify(out);
        return { output: [{ type: "text", text: text.slice(0, 20000) }] as Array<{ type: "text"; text: string }> };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { output: [{ type: "text", text: JSON.stringify({ error: msg.slice(0, 1000) }) }] as Array<{ type: "text"; text: string }> };
      }
    },
  });
}

const StrOpt = (description: string) => Type.String({ description });

export function buildBrowserExtension() {
  return defineExtension({
    name: "browser",
    tools: [
      browserTool(
        "browser_navigate",
        "Open a URL in the managed browser and return the document title. Prefer this over pixel clicks for web pages.",
        Type.Object({ url: Type.String({ description: "http(s) URL to open" }) }),
      ),
      browserTool(
        "browser_snapshot",
        "Capture a bounded snapshot of the current page with element refs (e1, e2, …). Use refs with browser_act.",
        Type.Object({}),
        { replay: "safe" },
      ),
      browserTool(
        "browser_act",
        "Click or fill page elements by ref from browser_snapshot (kinds: click, fill, type). Never replay completed or uncertain actions.",
        Type.Object({
          actions: Type.Array(Type.Unsafe({ type: "object", additionalProperties: true }), { description: "Page actions by ref (max 24)" }),
        }),
      ),
      browserTool(
        "browser_screenshot",
        "Screenshot the managed browser window. Returns frame metadata and an image. Use before x/y coordinate actions.",
        Type.Object({}),
        { replay: "safe" },
      ),
      browserTool(
        "browser_pixel_act",
        "Perform up to 24 ordered x/y actions inside the managed browser window. Max 2 attempts per action — on failure inspect state and switch methods.",
        Type.Object({
          actions: Type.Array(Type.Unsafe({ type: "object", additionalProperties: true }), { description: "Ordered actions (max 24)" }),
          observe: Type.Optional(Type.Boolean({ description: "Screenshot after acting (default true)" })),
          settle_ms: Type.Optional(Type.Number({ description: "Ms to wait before the screenshot (0-5000)" })),
        }),
      ),
      browserTool(
        "open_path",
        "Open a workspace file in its OS default app, or an http(s) URL in the managed browser.",
        Type.Object({ path: StrOpt("Workspace-relative file path or http(s) URL to open") }),
      ),
      browserTool(
        "dev_server",
        "Start (or reuse) a local dev server, wait until the URL responds, and open it in the managed browser for UI testing. Localhost URLs only.",
        Type.Object({
          command: StrOpt("Dev command, e.g. 'npm run dev -- -p 3010'"),
          url: StrOpt("URL to wait for, e.g. 'http://localhost:3010'"),
          timeoutMs: Type.Optional(Type.Number({ description: "Wait-for-HTTP timeout in ms (default 30000)" })),
          stop: Type.Optional(Type.Boolean({ description: "Stop the server for this command" })),
        }),
      ),
      browserTool(
        "dev_server_log",
        "Read the tail of a dev server's captured stdout/stderr (started via dev_server).",
        Type.Object({
          command: StrOpt("The same command passed to dev_server"),
          tail: Type.Optional(Type.Number({ description: "Lines to return (default 60, max 200)" })),
        }),
        { replay: "safe" },
      ),
      browserTool(
        "request_takeover",
        "Ask the user to take control for protected input or human judgment (site login, captcha, 2FA, payment). On background runs there is no interactive user, so this reports that and tells you to proceed autonomously or report the blocker.",
        Type.Object({ reason: StrOpt("Why human input is needed") }),
      ),
      browserTool(
        "computer_clipboard_read",
        "Read the OS clipboard text (up to 4000 chars). Read-only.",
        Type.Object({}),
        { replay: "safe" },
      ),
      browserTool(
        "computer_clipboard_write",
        "Write text to the OS clipboard (up to 100k chars). Requires approval; background runs are refused.",
        Type.Object({ text: StrOpt("Text to put on the clipboard") }),
      ),
    ],
  });
}

/** Test-only: drop the cached kernel tools so tests get fresh threads. */
export function resetDurableBrowserForTests(): void {
  kernelToolsCache = null;
}
