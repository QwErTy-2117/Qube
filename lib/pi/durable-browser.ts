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

/**
 * Per-turn context for the durable browser extension. The registry (and
 * this extension) is process-global, but turns carry their own thread and
 * foreground-ness: streamDurableToWriter records them per turn, and tool
 * executes resolve their chat thread via resolveBrowserThread below.
 * Unknown threads default to headless-safe (deny above interact).
 */
const turnContexts = new Map<string, { interactive: boolean }>();
export function setBrowserTurnContext(threadId: string, ctx: { interactive: boolean }): void {
  try {
    turnContexts.set(String(threadId), { interactive: !!ctx.interactive });
    while (turnContexts.size > 100) {
      const oldest = turnContexts.keys().next().value as string | undefined;
      if (!oldest) break;
      turnContexts.delete(oldest);
    }
  } catch {}
}

const conversationThreads = new Map<string, string>();

/**
 * Resolve the chat thread + interactivity for a durable tool call. The
 * tool api carries conversationId (durable conversation) while the kernel
 * and permission UI work in chat-thread terms — map via the ThreadMap
 * ledger (cached; re-read on miss). Without a conversationId there is no
 * thread to map to, so fall back to the per-call taskId, headless.
 */
export async function resolveBrowserThread(api: unknown): Promise<{ threadId: string; interactive: boolean }> {
  const fallback = String((api as any)?.taskId || "durable");
  const conversationId = (api as any)?.conversationId;
  if (typeof conversationId !== "string" || !conversationId) return { threadId: fallback, interactive: false };
  const hit = conversationThreads.get(conversationId);
  if (hit) {
    const ctx = turnContexts.get(hit);
    return { threadId: hit, interactive: ctx?.interactive ?? false };
  }
  try {
    const { getDurableHarness } = await import("@/lib/pi/durable");
    const { ThreadMap } = await import("@/lib/pi/durable-conversations");
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
    const h = await getDurableHarness(BACKGROUND_CONTEXT);
    const snap = await h.snapshot(ThreadMap, BACKGROUND_CONTEXT);
    const ids = (snap as any)?.ids as Record<string, string> | undefined;
    if (ids) {
      for (const [threadId, convId] of Object.entries(ids)) {
        if (typeof convId === "string" && convId) conversationThreads.set(convId, threadId);
      }
    }
    const threadId = conversationThreads.get(conversationId);
    if (threadId) {
      const ctx = turnContexts.get(threadId);
      return { threadId, interactive: ctx?.interactive ?? false };
    }
  } catch {}
  return { threadId: fallback, interactive: false };
}

let kernelToolsCache: { key: string; tools: Record<string, { execute: (args: unknown) => Promise<string> }> } | null = null;

async function kernelTool(api: unknown, name: string): Promise<(args: unknown) => Promise<string>> {
  const { threadId, interactive } = await resolveBrowserThread(api);
  const key = `${threadId} ${interactive ? "fg" : "bg"}`;
  if (!kernelToolsCache || kernelToolsCache.key !== key) {
    const kernel: KernelMod = await import("@/lib/computer-use/index");
    const { createPiTools } = await import("@/lib/pi/tools");
    const { createComputerTools } = await import("@/lib/pi/computer-tools");
    const raw: Record<string, any> = {
      ...createPiTools(threadId, { includeAskUser: interactive, includeSubagents: false, includeTodos: false }),
      ...createComputerTools(threadId, { includeAskUser: interactive }),
    };
    if (kernel.kernelEnabled()) {
      kernel.applyKernel(raw, { threadId, interactive });
    }
    const picked: Record<string, { execute: (args: unknown) => Promise<string> }> = {};
    for (const n of ["browser_navigate", "browser_snapshot", "browser_act", "browser_screenshot", "browser_pixel_act", "open_path", "dev_server", "dev_server_log", "request_takeover", "computer_clipboard_read", "computer_clipboard_write"]) {
      const def = raw[n];
      if (def && typeof def.execute === "function") picked[n] = { execute: (args: unknown) => def.execute(args) as Promise<string> };
    }
    kernelToolsCache = { key, tools: picked };
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
        const run = await kernelTool(api, name);
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

/** Drop cached kernel tools and turn/thread mappings. */
export function resetDurableBrowserForTests(): void {
  kernelToolsCache = null;
  turnContexts.clear();
  conversationThreads.clear();
}

/** Production hard-reset alias with the same deterministic behavior. */
export function resetDurableBrowserForHardReset(): void {
  resetDurableBrowserForTests();
}
