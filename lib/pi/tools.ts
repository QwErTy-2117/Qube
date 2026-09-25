import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile, unlink, readdir, stat, mkdir } from "node:fs/promises";
import { extname, join, dirname, normalize } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  getWorkspacePath,
  resolvePathInWorkspace,
  relativePathInWorkspace,
} from "@/lib/middleware/workspace";
import { withPermissionCheck } from "@/lib/middleware/permission-middleware";
import { allowedDirsStore, toAbsoluteDir } from "@/lib/permissions/allowed-dirs";

const execAsync = promisify(exec);

function formatError(e: unknown, path: string): string {
  const err = e as NodeJS.ErrnoException;
  const code = err.code || "UNKNOWN";
  return `${err.message || String(e)} (${code}) for ${path}`;
}

/**
 * Resolve a tool path, honoring user-approved Allowed directories
 * (Preferences / chat "allow always") for paths outside the workspace.
 */
function resolveAgentPath(targetPath: string, access: "read" | "write"): string {
  try {
    return resolvePathInWorkspace(targetPath);
  } catch (e) {
    const abs = toAbsoluteDir(targetPath, getWorkspacePath());
    if (abs && allowedDirsStore.isAllowed(abs, access)) return abs;
    throw e;
  }
}

/** Display path that never throws for outside-workspace files. */
function displayAgentPath(absolutePath: string): string {
  try {
    return relativePathInWorkspace(absolutePath);
  } catch {
    return absolutePath;
  }
}

export type PiToolsOptions = {
  includeSubagents?: boolean;
  includeTodos?: boolean;
  includeAskUser?: boolean;
  parentModelName?: string | null;
  request?: Request;
  threadIdForScratchpad?: string;
};

export function createPiTools(threadId: string, opts?: PiToolsOptions) {
  const withPerm = (name: string, args: any, fn: () => Promise<string>) =>
    withPermissionCheck(name, args, threadId, fn);

  const includeSubagents = opts?.includeSubagents !== false;
  const includeTodos = opts?.includeTodos !== false;
  // Interactive questioning is for the foreground chat harness only —
  // subagents and scheduled tasks must proceed autonomously.
  const includeAskUser = opts?.includeAskUser !== false;
  // Same flag doubles as "is this an interactive foreground session":
  // only the chat harness may raise approval modals (questions, web).
  // Subagents and scheduled tasks run headless and must never block.
  const interactive = includeAskUser;

  const extraTools: Record<string, any> = {};

  // ask_question — blocking questionnaire answered in the docked
  // QuestionPanel. Pass 1-6 questions in ONE call (id, question,
  // optional header/options/multiSelect). Returns { answers } keyed by id.
  // Only call when genuinely blocked: ambiguous scope, real choices, or
  // confirmation before something hard to undo.
  if (includeAskUser) {
    extraTools.ask_question = tool({
      description:
        "Ask the user clarifying questions and WAIT for their answers (docked questionnaire panel). " +
        "Use when blocked by ambiguity, when there are real choices (provide `options`), or to confirm before something hard to undo. " +
        "Batch ALL questions for this decision into ONE call (up to 6) — never ask one-by-one across turns. " +
        "Keep each question to one sentence; options to 2-4 short labels (≤5 words each); set multiSelect only when several answers make sense. " +
        "The user may also type free text instead of picking options. " +
        "Do NOT use for anything answerable from files, tools, or prior context. Returns { answers: { <id>: string | string[] } }.",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              id: z.string().optional().describe("Stable key for the answer (default q1, q2, …)"),
              question: z.string().describe("One-sentence question"),
              header: z.string().optional().describe("Short label shown above the question"),
              options: z.array(z.string()).optional().describe("2-4 short selectable labels"),
              multiSelect: z.boolean().optional().describe("Allow picking several options"),
            })
          )
          .describe("1-6 questions for a single decision, asked together"),
      }),
      execute: async ({ questions }: { questions: unknown }) => {
        const { normalizeQuestions, createQuestionnaire } = await import(
          "@/lib/agent/tools/ask-user-tool"
        );
        const normalized = normalizeQuestions(questions);
        if ("error" in normalized) return `Error: ${normalized.error}.`;
        const { promise } = createQuestionnaire(threadId, normalized);
        const timeoutMs = parseInt(process.env.PERMISSION_TIMEOUT_MS || "300000", 10);
        const timeout = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs)
        );
        const answers = await Promise.race([promise, timeout]);
        if (answers === null) {
          return JSON.stringify({
            timedOut: true,
            answers: {},
            note: "The user did not answer in time. Proceed with your best judgment, state your assumptions in one sentence, and continue.",
          });
        }
        return JSON.stringify({ answers });
      },
    });
  }

  // TodoWrite — session task checklist (transcript IS the store, cc-style).
  // Each call replaces the entire snapshot. Frontend GoalsPanel derives
  // the docked goals UI above the composer from the last call.
  if (includeTodos) {
    extraTools.TodoWrite = tool({
      description:
        "Manage the session todo list (the user's goals panel). Pass the COMPLETE list each call — there is no per-item update API, you rewrite the entire snapshot. " +
        "ALWAYS create the list FIRST before starting any task with 3+ steps, multiple tool calls, or subagents — then work through it in order and respect it (add new work to the list before doing it). Exactly one item should be in_progress at a time. " +
        "Always provide both `content` (imperative, e.g. 'Run tests') and `activeForm` (present continuous, e.g. 'Running tests') so the UI can show what is happening now. " +
        "ALWAYS mark items complete the moment each sub-task finishes — even when there is only ONE item, call TodoWrite again to flip it to completed. Never end a task with items still in_progress. " +
        "If your turn ends with items unfinished you will get a silent nudge to continue — keep working until everything is completed, then summarize. " +
        "Update immediately after finishing a sub-task. If you change direction, rewrite the list with dropped items removed. " +
        "When all items are completed the goals panel clears (session-scoped, ephemeral).",
      inputSchema: z.object({
        todos: z
          .array(
            z.object({
              content: z.string().describe("Imperative form, e.g. 'Run tests'"),
              status: z.enum(["pending", "in_progress", "completed"]),
              activeForm: z.string().describe("Present continuous, e.g. 'Running tests'"),
            })
          )
          .describe("The updated todo list. Replaces any previous list."),
      }),
      execute: async ({ todos }: { todos: Array<{ content: string; status: string; activeForm: string }> }) => {
        if (!Array.isArray(todos)) return "Error: `todos` must be an array.";
        // Transcript IS the store — no persistence needed. Return short confirmation.
        const done = todos.filter((t) => t.status === "completed").length;
        return `Todos have been updated (${done}/${todos.length} completed). Continue to use TodoWrite to track progress.`;
      },
    });
  }

  // subagent — spawn an isolated child (fresh context, no parent history).
  // Child inherits narrowed tools, NEVER includes `subagent` (recursion guard).
  if (includeSubagents) {
    extraTools.subagent = tool({
      description:
        "Spawn a focused subagent in a fresh, isolated context window. Use when a side task would flood the main conversation (codebase recon, research, review, parallel exploration). " +
        "The subagent does NOT see parent history — the `task` must be fully self-contained (file paths, requirements, output contract). " +
        "It works autonomously and returns a single summary string. " +
        "Agent types: Explore (fast codebase recon, read-only), researcher (web/docs brief), reviewer (read-only review), general (full tools). " +
        "For parallel work, call `subagent` multiple times in one turn. If order matters, chain sequentially. " +
        "Keep prompts lean and demand structured output. Validate results before using downstream.",
      inputSchema: z.object({
        description: z.string().describe("Short 3-5 word task label, shown in UI pill (e.g. 'Explore frontend architecture')"),
        prompt: z.string().describe("Fully self-contained task for the subagent, including paths, scope, and required output format"),
        agentType: z
          .string()
          .optional()
          .describe("Subagent persona: Explore, researcher, reviewer, general (default general)"),
      }),
      execute: async ({
        description,
        prompt,
        agentType,
      }: {
        description: string;
        prompt: string;
        agentType?: string;
      }) => {
        try {
          const { runSubagent } = await import("./subagents");
          const result = await runSubagent({
            description,
            prompt,
            agentType,
            parentThreadId: threadId,
            modelName: opts?.parentModelName || null,
            request: opts?.request,
          });
          return JSON.stringify(result);
        } catch (e: any) {
          const msg = e instanceof Error ? e.message : String(e);
          return JSON.stringify({
            title: agentType || "general",
            description: description || "Subagent task",
            subagentType: agentType || "general",
            status: "failed",
            summary: "",
            error: msg.slice(0, 2000),
            task: prompt,
            steps: [],
          });
        }
      },
    });
  }

  // Scratchpad — per-thread markdown file for multi-step state (agent decides when to use).
  const scratchId = opts?.threadIdForScratchpad || threadId;
  extraTools.read_scratchpad = tool({
    description: "Read the thread scratchpad (per-thread markdown notes for multi-step work). Cheap, outside context — use JIT when you need to recall plan/findings.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { readScratchpad } = await import("./scratchpad");
        const content = await readScratchpad(scratchId);
        if (!content) return "Scratchpad is empty (no notes yet). Create it with write_scratchpad when the task has >3 steps or state to carry.";
        return content.slice(0, 20000);
      } catch (e: any) {
        return `Error: ${e?.message || String(e)}`;
      }
    },
  });
  extraTools.write_scratchpad = tool({
    description: "Create or overwrite the thread scratchpad. Use for multi-step tasks: keep Goal, Constraints, Plan (checkboxes), Findings, Next. Update before/after each TodoWrite flip. Overwrites the whole file.",
    inputSchema: z.object({ content: z.string().describe("Markdown content for the scratchpad") }),
    execute: async ({ content }: { content: string }) => {
      try {
        const { writeScratchpad, scratchpadPath } = await import("./scratchpad");
        await writeScratchpad(scratchId, content);
        return JSON.stringify({ path: scratchpadPath(scratchId), status: "written", chars: content.length });
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    },
  });
  extraTools.append_scratchpad = tool({
    description: "Append a section to the scratchpad (cheaper than rewriting the whole file for incremental notes).",
    inputSchema: z.object({ chunk: z.string().describe("Markdown chunk to append") }),
    execute: async ({ chunk }: { chunk: string }) => {
      try {
        const { appendScratchpad } = await import("./scratchpad");
        await appendScratchpad(scratchId, chunk);
        return "Appended to scratchpad.";
      } catch (e: any) {
        return `Error: ${e?.message || String(e)}`;
      }
    },
  });

  // Browser-only automation (Rakazo parity: browser_screenshot /
  // browser_pixel_act / browser_navigate / browser_snapshot / browser_act /
  // request_takeover). Backed by the managed browser window via CDP.
  // NOT OS desktop control. Vision: screenshots reach the MODEL via
  // toModelOutput (image-data parts) backed by the frame cache in
  // computer-use — never as base64 inside the JSON text.
  async function modelOutputWithFrame(output: unknown): Promise<any> {
    try {
      const { recallFrame } = await import("./computer-use");
      const parsed = typeof output === "string" ? JSON.parse(output) : (output as any);
      const fid = (parsed as any)?.frameId as string | undefined;
      const bytes = fid ? recallFrame(fid) : undefined;
      const text = typeof output === "string" ? output : JSON.stringify(output);
      if (bytes) {
        return {
          type: "content",
          value: [
            { type: "text", text: text.slice(0, 2000) },
            { type: "image-data", data: bytes, mediaType: "image/jpeg" },
          ],
        };
      }
      return { type: "text", value: text.slice(0, 4000) };
    } catch {
      return { type: "text", value: String(output).slice(0, 4000) };
    }
  }
  async function runBrowserScreenshot(): Promise<string> {
    try {
      const { browserScreenshot, screenClaim } = await import("./computer-use");
      try { screenClaim.claim(threadId); } catch (e: any) { return JSON.stringify({ error: e?.message || String(e) }); }
      const obs = await browserScreenshot("browser observed");
      if (obs.error && !obs.imageBase64) return JSON.stringify({ error: obs.error, text: obs.text });
      return JSON.stringify({ text: obs.text, frameId: obs.frameId, unchanged: !!obs.unchanged, imageChars: obs.imageBase64?.length || 0 });
    } catch (e: any) {
      return JSON.stringify({ error: e?.message || String(e) });
    }
  }
  async function runBrowserPixelAct(actions: unknown, observe?: boolean, settle_ms?: number): Promise<string> {
    return withPerm("browser_pixel_act", { actions }, async () => {
      try {
        const { browserPixelAct, screenClaim } = await import("./computer-use");
        try { screenClaim.claim(threadId); } catch (e: any) { return JSON.stringify({ error: e?.message || String(e) }); }
        const res = await browserPixelAct(actions as any, { observe, settleMs: settle_ms });
        // Keep base64 out of the transcript text — the model gets the real
        // bytes via toModelOutput. Report the byte count instead.
        const { imageBase64, ...rest } = res as any;
        void imageBase64;
        return JSON.stringify({ ...rest, imageChars: (res as any)?.imageBase64?.length || 0 }).slice(0, 12000);
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e) });
      }
    });
  }
  const BROWSER_SCREENSHOT_DESC =
    "Screenshot the managed browser window (NOT the OS desktop). Returns frame metadata and an image. Use before x/y coordinate actions and whenever the page may have changed. Identical consecutive frames omit image bytes.";
  const BROWSER_PIXEL_ACT_DESC =
    "Perform up to 24 ordered x/y actions inside the managed browser window and return the resulting screenshot. NOT OS desktop control. Batch only predictable actions; stop before an outcome you need to inspect. " +
    "Valid kinds ONLY: click {x,y}, move {x,y}, down {x,y}, up {x,y}, type {text}, key {key, modifiers?}, scroll {direction,amount}, wait {ms}. " +
    "Key modifiers allowed: Ctrl, Shift, Alt (no Meta/Super/Win). Examples: {kind:\"click\",x:640,y:450}, {kind:\"type\",text:\"hello\"}, {kind:\"key\",key:\"Enter\"}. " +
    "There is no OS Start menu/launcher — NEVER try to open local apps like calculator or text editor with coordinates or Super/Meta keys. " +
    "For workspace files/URLs use open_path; for shell work use run_command. Max 2 attempts per action — on failure inspect state and switch methods, never replay the same failing call.";
  const pixelActSchema = {
    actions: z.array(z.record(z.string(), z.any())).describe("Ordered actions (max 24)"),
    observe: z.boolean().optional().describe("Screenshot after acting (default true)"),
    settle_ms: z.number().optional().describe("Ms to wait before the screenshot (0-5000)"),
  };
  extraTools.browser_screenshot = tool({
    description: BROWSER_SCREENSHOT_DESC,
    inputSchema: z.object({}),
    execute: runBrowserScreenshot,
    toModelOutput: async ({ output }: any) => modelOutputWithFrame(output),
  });
  extraTools.browser_pixel_act = tool({
    description: BROWSER_PIXEL_ACT_DESC,
    inputSchema: z.object(pixelActSchema),
    execute: async ({ actions, observe, settle_ms }: { actions: unknown; observe?: boolean; settle_ms?: number }) =>
      runBrowserPixelAct(actions, observe, settle_ms),
    toModelOutput: async ({ output }: any) => modelOutputWithFrame(output),
  });
  // Deprecated aliases — kept so old sessions keep working. The model must
  // use the browser_* names above; these only exist for back-compat.
  extraTools.computer_observe = tool({
    description: `[DEPRECATED alias of browser_screenshot — use browser_screenshot instead.] ${BROWSER_SCREENSHOT_DESC}`,
    inputSchema: z.object({}),
    execute: runBrowserScreenshot,
    toModelOutput: async ({ output }: any) => modelOutputWithFrame(output),
  });
  extraTools.computer_act = tool({
    description: `[DEPRECATED alias of browser_pixel_act — use browser_pixel_act instead.] ${BROWSER_PIXEL_ACT_DESC}`,
    inputSchema: z.object(pixelActSchema),
    execute: async ({ actions, observe, settle_ms }: { actions: unknown; observe?: boolean; settle_ms?: number }) =>
      runBrowserPixelAct(actions, observe, settle_ms),
    toModelOutput: async ({ output }: any) => modelOutputWithFrame(output),
  });
  // open_path: open a workspace file in its OS default app (outside the
  // browser — the agent CANNOT see that app), or an http(s) URL in the
  // managed browser (visible via browser_screenshot).
  extraTools.open_path = tool({
    description:
      "Open a workspace file in its OS default app, or an http(s) URL in the managed browser. " +
      "NOTE: OS apps open outside the browser and are NOT visible to the agent — for files this returns only an open confirmation, not a screenshot of the file. " +
      "For URLs it navigates the managed browser and returns a browser screenshot. " +
      "It cannot open or control OS apps like calculator or text editor for the agent to see. " +
      "Use for visual/binary files that read_file cannot show (images, PDFs, decks), knowing the agent sees only browser URLs, never OS app windows.",
    inputSchema: z.object({
      path: z.string().describe("Workspace-relative file path or http(s) URL to open"),
    }),
    execute: async ({ path }: { path: string }) => {
      return withPerm("open_path", { path }, async () => {
        try {
          const target = String(path || "").trim();
          if (!target) return JSON.stringify({ error: "path is required" });
          const { browserScreenshot, browserNavigate, screenClaim } = await import("./computer-use");
          try { screenClaim.claim(threadId); } catch (e: any) { return JSON.stringify({ error: e?.message || String(e) }); }
          if (/^https?:\/\//i.test(target)) {
            const nav = await browserNavigate(target);
            const obs = await browserScreenshot(`open_path ${target}`);
            return JSON.stringify({ url: (nav as any).url || target, title: (nav as any).title || "", screen: obs.text }).slice(0, 6000);
          }
          const resolved = resolveAgentPath(target, "read");
          const { execFile } = await import("node:child_process");
          const plat = process.platform;
          const cmd = plat === "darwin" ? "open" : plat === "win32" ? "cmd" : "xdg-open";
          const args = plat === "darwin" ? [resolved] : plat === "win32" ? ["/c", "start", "", resolved] : [resolved];
          await new Promise<void>((resolve, reject) => {
            const child = execFile(cmd, args, { timeout: 10000, windowsHide: true }, (err) => {
              if (err) reject(err);
              else resolve();
            });
            // Don't keep the agent waiting on the opened app: detach the timer.
            try { child.unref(); } catch {}
          });
          // OS apps open outside the managed browser: no screenshot can show
          // them. Return an honest confirmation instead of a browser frame.
          return JSON.stringify({
            path: resolved,
            status: "opened",
            visibleToAgent: false,
            note: "Opened in the OS default app, outside the managed browser. The agent cannot see or control OS app windows — use read_file/list_directory/run_command to work with the file's contents.",
          }).slice(0, 2000);
        } catch (e: any) {
          return JSON.stringify({ error: e?.message || String(e) });
        }
      });
    },
  });
  extraTools.browser_navigate = tool({
    description:
      'Open a URL in the managed browser and return the document title. Prefer this over pixel clicks for web pages. If the result includes fallback:"browser_pixel_act", use browser_pixel_act in the same browser window instead.',
    inputSchema: z.object({ url: z.string().describe("http(s) URL to open") }),
    execute: async ({ url }: { url: string }) => {
      try {
        const { browserNavigate } = await import("./computer-use");
        const res = await browserNavigate(String(url || ""));
        return JSON.stringify(res).slice(0, 4000);
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e), fallback: "browser_pixel_act" });
      }
    },
  });
  extraTools.browser_snapshot = tool({
    description:
      "Capture a bounded snapshot of the current page with element refs (e1, e2, …). Use refs with browser_act. Prefer this over browser_screenshot for web pages. If fallback is browser_pixel_act, use pixel/coordinate tools in the same browser window instead.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const { browserSnapshot } = await import("./computer-use");
        const res = await browserSnapshot();
        const out = { url: res.url, title: res.title, tree: res.tree?.slice(0, 8000), elements: res.elements, fallback: (res as any).fallback, error: (res as any).error, note: (res as any).note };
        return JSON.stringify(out).slice(0, 12000);
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e), fallback: "browser_pixel_act" });
      }
    },
  });
  extraTools.browser_act = tool({
    description:
      'Click or fill page elements by ref from browser_snapshot (kinds: click, fill, type). Prefer this over browser_pixel_act for web pages. If the result includes fallback:"browser_pixel_act", use browser_pixel_act instead. Never replay completed or uncertain actions.',
    inputSchema: z.object({
      actions: z.array(z.record(z.string(), z.any())).describe("Page actions by ref (max 24)"),
    }),
    execute: async ({ actions }: { actions: unknown }) => {
      try {
        const { browserAct } = await import("./computer-use");
        const res = await browserAct(actions as any);
        return JSON.stringify(res).slice(0, 6000);
      } catch (e: any) {
        return JSON.stringify({ error: e?.message || String(e), fallback: "browser_pixel_act", uncertain: true });
      }
    },
  });
  extraTools.request_takeover = tool({
    description:
      "Ask the user to take control for protected input or human judgment (site login, captcha, 2FA, payment). The run pauses as waiting_takeover; the user acts in the Browser panel, then the run continues. Use when browser tools cannot operate or credentials must stay with the user.",
    inputSchema: z.object({ reason: z.string().describe("Why human input is needed") }),
    execute: async ({ reason }: { reason: string }) => {
      if (!interactive) {
        return JSON.stringify({ queued: false, error: "No interactive user in this run (background/subagent). Proceed autonomously or report the blocker." });
      }
      return withPerm("request_takeover", { reason }, async () => {
        try {
          const { normalizeQuestions, createQuestionnaire } = await import("@/lib/agent/tools/ask-user-tool");
          const { takeoverLeaseMs } = await import("./computer-use");
          const normalized = normalizeQuestions([{ id: "takeover", question: `Takeover needed: ${String(reason || "protected input")}. Take control in the Browser panel, then confirm to continue.` }]);
          if ("error" in normalized) return JSON.stringify({ error: normalized.error });
          const { promise } = createQuestionnaire(threadId, normalized);
          // Takeover lease TTL (Rakazo parity: 15 min — logins/captchas take
          // longer than a permission click), not the generic approval timeout.
          const timeoutMs = takeoverLeaseMs();
          const answers = await Promise.race([promise, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
          if (answers === null) return JSON.stringify({ timedOut: true, status: "waiting_takeover", note: "User did not respond. Re-observe and continue or ask again once." });
          return JSON.stringify({ status: "takeover_complete", answers });
        } catch (e: any) {
          return JSON.stringify({ error: e?.message || String(e) });
        }
      });
    },
  });

  return {
    ...extraTools,
    present_file: tool({
      description: "Surface a workspace file in chat as a slim file card, rendered in a list at the bottom of your reply. Call this ONCE per FINAL deliverable (document, spreadsheet, presentation, image, code). Only documents, spreadsheets and code get an Open button (viewer popup); images, PDFs and presentations are download-only. NEVER present intermediate builder/scaffolding scripts (e.g. .py scripts used to generate a .docx/.xlsx/.pptx) — only the final outputs. For presentations always present the real presentations/*.pptx file (python-pptx), never an .md outline.",
      inputSchema: z.object({
        path: z.string().describe("Workspace-relative path of an existing file"),
      }),
      execute: async ({ path }: { path: string }) => {
        return withPerm("present_file", { path }, async () => {
          const resolved = resolveAgentPath(path, "read");
          try {
            const s = await stat(resolved);
            if (!s.isFile()) return JSON.stringify({ error: `Not a file: ${path}` });
            return JSON.stringify({
              path: resolved,
              relativePath: displayAgentPath(resolved),
              filename: displayAgentPath(resolved).split("/").pop() || path,
              size: s.size,
              status: "presented",
            });
          } catch (e) {
            return JSON.stringify({ error: formatError(e, path), code: (e as NodeJS.ErrnoException).code });
          }
        });
      },
    }),

    read_file: tool({
      description: "Read a file at a workspace-relative path (absolute paths work too when inside a user-approved Allowed directory). Returns content and metadata.",
      inputSchema: z.object({
        path: z.string().describe("Workspace-relative path"),
      }),
      execute: async ({ path }: { path: string }) => {
        return withPerm("read_file", { path }, async () => {
          const resolved = resolveAgentPath(path, "read");
          try {
            const content = await readFile(resolved, "utf-8");
            const s = await stat(resolved);
            const lines = content.split("\n").length;
            return JSON.stringify({
              path: resolved,
              relativePath: displayAgentPath(resolved),
              size: s.size,
              lineCount: lines,
              content,
            });
          } catch (e) {
            return JSON.stringify({ error: formatError(e, path), code: (e as NodeJS.ErrnoException).code });
          }
        });
      },
    }),

    write_file: tool({
      description: "Create or overwrite a file. Auto-creates parent dirs. Use documents/, presentations/, spreadsheets/, images/, code/ for outputs. Absolute paths work too when inside a user-approved Allowed directory with write access.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        return withPerm("write_file", { path, content }, async () => {
          const resolved = resolveAgentPath(path, "write");
          await mkdir(dirname(resolved), { recursive: true });
          await writeFile(resolved, content, "utf-8");
          const s = await stat(resolved);
          return JSON.stringify({
            path: resolved,
            relativePath: relativePathInWorkspace(resolved),
            size: s.size,
            status: "written",
          });
        });
      },
    }),

    edit_file: tool({
      description: "Find exact text in a file and replace it. Read file first to get exact string.",
      inputSchema: z.object({
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
      }),
      execute: async ({ path, oldString, newString }: { path: string; oldString: string; newString: string }) => {
        return withPerm("edit_file", { path, oldString, newString }, async () => {
          const resolved = resolveAgentPath(path, "write");
          const content = await readFile(resolved, "utf-8");
          if (!content.includes(oldString)) {
            return JSON.stringify({ error: "Text not found", hint: "Read file first for exact match" });
          }
          if (content.indexOf(oldString) !== content.lastIndexOf(oldString)) {
            return JSON.stringify({ error: "Multiple matches — provide more context" });
          }
          const next = content.replace(oldString, newString);
          await writeFile(resolved, next, "utf-8");
          return JSON.stringify({ path: resolved, status: "edited" });
        });
      },
    }),

    delete_file: tool({
      description: "Delete a file at workspace-relative path.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        return withPerm("delete_file", { path }, async () => {
          const resolved = resolveAgentPath(path, "write");
          await unlink(resolved);
          return JSON.stringify({ path: resolved, status: "deleted" });
        });
      },
    }),

    list_directory: tool({
      description: "List files and directories at a workspace-relative path (absolute paths work too when inside a user-approved Allowed directory).",
      inputSchema: z.object({
        path: z.string().describe("Workspace-relative path, e.g. '.' , 'documents'"),
      }),
      execute: async ({ path }: { path: string }) => {
        return withPerm("list_directory", { path }, async () => {
          const resolved = resolveAgentPath(path, "read");
          try {
            const entries = await readdir(resolved, { withFileTypes: true });
            const items = await Promise.all(
              entries.slice(0, 500).map(async (e) => {
                const full = join(resolved, e.name);
                let size = 0;
                try {
                  const s = await stat(full);
                  size = s.size;
                } catch {}
                return {
                  name: e.name,
                  type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other",
                  size,
                  path: full,
                  normalizedPath: normalize(full),
                };
              })
            );
            return JSON.stringify({
              path: resolved,
              items,
              totalItems: entries.length,
              truncated: entries.length > 500,
            });
          } catch (e) {
            return JSON.stringify({ error: formatError(e, path), code: (e as NodeJS.ErrnoException).code });
          }
        });
      },
    }),

    run_command: tool({
      description: "Run a shell command in workspace. 120s timeout. Use for builds, tests, scripts.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to run"),
        timeoutMs: z.number().optional().describe("Timeout in ms, default 120000"),
      }),
      execute: async ({ command, timeoutMs }: { command: string; timeoutMs?: number }) => {
        return withPerm("run_command", { command }, async () => {
          const cwd = getWorkspacePath();
          const timeout = timeoutMs ?? 120000;
          try {
            const { stdout, stderr } = await execAsync(command, {
              cwd,
              timeout,
              maxBuffer: 10 * 1024 * 1024,
              windowsHide: true,
            });
            return JSON.stringify({
              command,
              cwd,
              stdout: stdout.slice(0, 20000),
              stderr: stderr.slice(0, 20000),
              exitCode: 0,
            });
          } catch (e: any) {
            const stdout = e.stdout?.toString().slice(0, 20000) || "";
            const stderr = e.stderr?.toString().slice(0, 20000) || e.message?.slice(0, 5000) || String(e).slice(0, 5000);
            const exitCode = typeof e.code === "number" ? e.code : 1;
            const timedOut = e.killed && e.signal === "SIGTERM";
            return JSON.stringify({
              command,
              cwd,
              stdout,
              stderr,
              exitCode,
              timedOut,
              error: timedOut ? `Timeout after ${timeout}ms` : undefined,
            });
          }
        });
      },
    }),

    web_search: tool({
      description: "Search the web (DuckDuckGo) for up-to-date information. Returns up to maxResults (default 6, max 10) with title, URL, snippet. No approval needed — batch needed searches together.",
      inputSchema: z.object({
        query: z.string(),
        maxResults: z.number().optional().describe("Max results 1-10 (default 6)"),
      }),
      execute: async ({ query, maxResults }: { query: string; maxResults?: number }) => {
        const { clampMaxResults } = await import("@/lib/agent/browser/ssrf-dns");
        const limit = clampMaxResults(maxResults);
        const run = async (): Promise<string> => {
        try {
          const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: { "User-Agent": "Mozilla/5.0 Qube/Pi" },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
          const html = await res.text();
          const links: any[] = [];
          const re = /<a[^>]+class="result__url"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
          let m;
          while ((m = re.exec(html)) && links.length < limit) {
            try {
              const href = m[1];
              const title = m[2]?.trim() || href;
              let url = href;
              try {
                const u = new URL(href, "https://duckduckgo.com");
                if (u.searchParams.get("uddg")) url = decodeURIComponent(u.searchParams.get("uddg")!);
              } catch {}
              links.push({ title, url, snippet: "" });
            } catch {}
          }
          if (links.length > 0) return JSON.stringify({ query, results: links });
          try {
            const mod: any = await import("@phukon/duckduckgo-search");
            const DDGS = mod.DDGS || mod.default;
            if (DDGS) {
              const ddgs = new DDGS({ timeout: 8000 });
              const raw: any[] = await ddgs.text({ keywords: query, maxResults: limit });
              const results = raw
                .map((r: any) => ({
                  title: r.title,
                  url: r.href,
                  snippet: (r.body || "").replace(/\s+/g, " ").trim().slice(0, 300),
                }))
                .filter((r: any) => r.url);
              return JSON.stringify({ query, results });
            }
          } catch {}
          return JSON.stringify({ query, results: links });
        } catch (e: any) {
          return JSON.stringify({ error: e.message || String(e), query, results: [] });
        }
        };
        // Web search leaves the workspace → approval modal in chat sessions.
        if (interactive) return withPerm("web_search", { query }, run);
        return run();
      },
    }),

    web_fetch: tool({
      description: "Fetch and extract cleaned text from a URL. Truncated to maxChars (default 25000, min 100, max 50000). No approval needed — batch needed fetches together.",
      inputSchema: z.object({
        url: z.string(),
        selector: z.string().optional().describe("CSS selector to extract specific section"),
        maxChars: z.number().optional().describe("Max chars 100-50000 (default 25000)"),
      }),
      execute: async ({ url, selector, maxChars }: { url: string; selector?: string; maxChars?: number }) => {
        const run = async (): Promise<string> => {
        try {
          // Rakazo web-ssrf parity: DNS + private-address + redirect + size guards.
          const { assertSafeWebUrl, clampMaxChars } = await import("@/lib/agent/browser/ssrf-dns");
          const charBudget = maxChars === undefined ? 25000 : clampMaxChars(maxChars);
          try {
            await assertSafeWebUrl(url);
          } catch (e: any) {
            return JSON.stringify({ error: e?.message || String(e), url });
          }
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 15000);
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 Qube/Pi" },
            signal: controller.signal,
          });
          clearTimeout(t);
          if (!res.ok) return JSON.stringify({ error: `Fetch failed ${res.status} ${res.statusText}`, url });
          const html = await res.text();
          const { JSDOM } = await import("jsdom");
          const dom = new JSDOM(html);
          const doc = dom.window.document;
          doc.querySelectorAll("script, style, noscript, iframe").forEach((el) => el.remove());
          let text: string;
          if (selector) {
            const el = doc.querySelector(selector);
            text = el ? (el.textContent || "") : doc.body.textContent || "";
          } else {
            text = doc.body.textContent || "";
          }
          text = text.replace(/\s+/g, " ").trim().slice(0, charBudget);
          return JSON.stringify({ url, content: text, length: text.length });
        } catch (e: any) {
          return JSON.stringify({ error: e.message || String(e), url });
        }
        };
        // Web fetch leaves the workspace → approval modal in chat sessions.
        if (interactive) return withPerm("web_fetch", { url, selector }, run);
        return run();
      },
    }),
  };
}

// Legacy alias for transitional callers
export const createCodexTools = createPiTools;
