import { streamText, generateText, tool } from "ai";
import { z } from "zod";
import { createModelClient, createModelClientForRequest } from "./model-client";
import { DDGS } from "@phukon/duckduckgo-search";
import { buildSystemPrompt } from "./system-prompt";
import { readFile, writeFile, unlink, readdir, stat, mkdir } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { withPermissionCheck } from "@/lib/middleware/permission-middleware";
import { getWorkspacePath, resolvePathInWorkspace, relativePathInWorkspace, resolveExternalPath } from "@/lib/middleware/workspace";
import { createPendingQuestion } from "./tools/ask-user-tool";
import { generateMemoryContext } from "./memory-agent";
import { createBrowserTools } from "./browser/browser-tools";
import { listSessions, readSessionSummary, readSession } from "@/lib/memory/session-store";
import { getMemoryEntries } from "@/lib/memory/memory-store";
import { getTasks, getTask, createTask, updateTask, deleteTask, updateTaskRunTime } from "@/lib/scheduler/task-store";
import { executeTask } from "@/lib/scheduler/task-executor";
import { computerUseStore } from "./computer/computer-store";
import { getComputerTools } from "./computer/computer-mcp";
import { providerStore } from "./provider-store";
import { detectModelImageSupport } from "@/lib/agent/vision-support";
import { getConnectorTools, initiateConnection, COMPOSIO_TOOLKIT_MAP, DEFAULT_USER_ID } from "@/lib/connectors/composio";

export function hasVisionCapability(modelName: string): boolean {
  let provResult = providerStore.getProviderByModel(modelName);
  if (!provResult) {
    const defaultModel = providerStore.getDefaultModelId();
    if (defaultModel && defaultModel !== modelName) {
      provResult = providerStore.getProviderByModel(defaultModel);
    }
  }
  const qualifiedId = provResult ? `${provResult.provider.id}:${provResult.modelId}` : modelName;
  let hasImage = provResult?.provider.models.find(m =>
    m.id === qualifiedId
  )?.imageInput ?? false;
  if (!hasImage) {
    hasImage = detectModelImageSupport(provResult?.modelId || qualifiedId);
  }
  return hasImage;
}

const execAsync = promisify(exec);

function buildSubagentSystemPrompt(task: string, title: string, description: string, subagentType: string): string {
  return `You are a specialized subagent (${subagentType}). You have the SAME tool access as the main Qube agent — read_file, write_file, edit_file, delete_file, list_directory, run_command, web_search, web_fetch, browser_*, computer_*, and connector tools. USE THEM to accomplish the task; do not hallucinate file contents or pretend you acted.

Task: ${task}
Title: ${title}
Description: ${description}

Rules:
- Act directly with tools. If the task says "create a file", actually call write_file. If it says "research", call web_search/web_fetch.
- Keep your response concise and tool-driven. Show work via tool calls.
- At the END of your final answer, you MUST include a structured handoff so the main agent knows what is missing. Format EXACTLY like this (markdown):

**Summary:** 1-3 sentence summary of what you did.

**Completed:** bullet list of concrete actions you actually performed (tools called, files created).

**Artifacts:** bullet list of file paths you created/modified (or "None").

**Remaining / Missing:** bullet list of tasks from the original request that you did NOT complete and are still missing, or "None - task complete" if fully done.

**Next steps for main:** single sentence instruction for the main agent, or "None - main can finalize" if complete.

Do NOT just say "finished" — explicitly list what is missing. The main agent will NOT redo Completed items; it will only do Remaining.

Example when complete:
**Summary:** Created code/Dashboard.tsx with a responsive metrics dashboard and saved to code/Dashboard.tsx.
**Completed:** - Created code/Dashboard.tsx (write_file) - Ran npm run build to verify (run_command)
**Artifacts:** - code/Dashboard.tsx
**Remaining / Missing:** None - task complete
**Next steps for main:** None - main can finalize and show [file: code/Dashboard.tsx]

Example when partial:
**Summary:** Researched Stripe API and drafted pricing section but did not create the file.
**Completed:** - web_search for Stripe pricing docs
**Artifacts:** None
**Remaining / Missing:** - Create presentations/pricing.pptx with researched data
**Next steps for main:** Create presentations/pricing.pptx using the research above.
`;
}

const DOWNLOADABLE_EXTS = new Set(['.pptx', '.docx', '.xlsx', '.pdf', '.csv', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.svg']);

async function scanGeneratedFiles() {
  const ws = getWorkspacePath();
  const generated: Array<{ name: string; relativePath: string; size: number }> = [];
  const now = Date.now();

  async function walk(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".git") {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (DOWNLOADABLE_EXTS.has(ext)) {
            try {
              const s = await stat(fullPath);
              const birth = s.birthtime?.getTime() || s.ctime.getTime();
              if (now - birth < 120_000) {
                generated.push({
                  name: entry.name,
                  relativePath: relativePathInWorkspace(fullPath),
                  size: s.size,
                });
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  await walk(ws);
  return generated;
}

export type AgentConfig = {
  systemPrompt?: string;
  messages: Array<Record<string, unknown>>;
  threadId?: string;
  modelName?: string;
  customSystemPrompt?: string;
  temperature?: number;
  userName?: string;
  userAbout?: string;
  instanceId?: string;
  reasoningEffort?: string;
  request?: Request;
};

export async function createAgent(config: AgentConfig) {
  const threadId = config.threadId || `thread_${Date.now()}`;
  // Parallelize slow I/O: memory + MCP tool discovery (Cua/browser-use/Composio) — was sequential and added ~2-4s to first token
  const [memoryContext, computerTools, composioTools, browserTools] = await Promise.all([
    generateMemoryContext(),
    (async () => {
      if (!computerUseStore.getAll().enabled) return {} as Record<string, any>;
      try {
        if (!hasVisionCapability(config.modelName || "")) {
          console.warn(`[agent] Computer use enabled but model "${config.modelName}" has no vision — tools still exposed`);
        }
        const tools = await getComputerTools();
        if (Object.keys(tools).length === 0) console.warn("[agent] Cua driver returned 0 tools — is cua-driver installed?");
        else console.log(`[agent] Loaded ${Object.keys(tools).length} Cua tools`);
        return tools;
      } catch (e) {
        console.error("[agent] Failed to init computer tools (Cua):", e);
        return {} as Record<string, any>;
      }
    })(),
    (async () => {
      try {
        return await getConnectorTools(config.instanceId);
      } catch (e) {
        console.error("[agent] Failed to init Composio tools:", e);
        return {} as Record<string, any>;
      }
    })(),
    (async () => {
      try {
        return await createBrowserTools(threadId);
      } catch (e) {
        console.error("[agent] Failed to init browser-use tools:", e);
        return {} as Record<string, any>;
      }
    })(),
  ]);
  const basePrompt = buildSystemPrompt(memoryContext);

  let userInfoSection = "";
  if (config.userName || config.userAbout) {
    const parts: string[] = [];
    if (config.userName) parts.push(`User name: ${config.userName}`);
    if (config.userAbout) parts.push(`About the user: ${config.userAbout}`);
    userInfoSection = `\n\n## User Context\n\n${parts.join("\n")}`;
  }

  const cuEnabled = computerUseStore.getAll().enabled;
  const hasVision = hasVisionCapability(config.modelName || "");
  const computerUseNote = cuEnabled && !hasVision
    ? "\n\n## Computer Use Notice\n\nComputer Use is enabled and works even without vision via the accessibility tree. Use get_window_state / get_accessibility_tree to find element_index and act with click/type_text/press_key by element_index. Screenshots are optional — only needed for pixel actions on canvas/WebGL. Do not refuse desktop tasks due to lack of vision; prefer AX element actions."
    : "";

  const systemPrompt = config.systemPrompt || (
    config.customSystemPrompt
      ? `${basePrompt}${userInfoSection}${computerUseNote}\n\n## Custom System Instructions\n\n${config.customSystemPrompt}`
      : `${basePrompt}${userInfoSection}${computerUseNote}`
  );

  const ep = (name: string, fn: (...args: any[]) => Promise<string>) => {
    return async (...args: any[]) => {
      const input = typeof args[0] === "object" && args[0] !== null ? args[0] : {};
      try {
        return await withPermissionCheck(name, input, threadId, () => fn(input));
      } catch (err) {
        console.error(`[ep:${name}] Tool error:`, err);
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        return JSON.stringify({ error: true, tool: name, message: msg });
      }
    };
  };

  const provResult = providerStore.getProviderByModel(config.modelName || "");
  const providerId = provResult?.provider.id;

  const providerOptions: Record<string, any> = {};
  const effort = config.reasoningEffort;
  if (effort && effort !== "off") {
    if (providerId === "openai") {
      providerOptions.openai = { reasoningEffort: effort };
    } else if (providerId === "mistral") {
      providerOptions.mistral = { reasoningEffort: effort };
    } else if (providerId === "chatgpt") {
      // ChatGPT proxy reads reasoning effort via header or providerOptions; we set both for compatibility
      providerOptions.openai = { reasoningEffort: effort };
    }
  }

  const resolveModelClient = (modelId?: string | null) => {
    const target = modelId || config.modelName || "";
    const r = providerStore.getProviderByModel(target);
    if (r?.provider.id === "chatgpt") {
      if (!config.request) {
        throw new Error(`ChatGPT model "${target}" requires request context. Call from HTTP handler with request.`);
      }
      return createModelClientForRequest(target, config.request);
    }
    return createModelClient(target);
  };

  // ---- Shared tool definitions (file + web + memory + tasks) ----
  const fileTools: Record<string, any> = {
    read_file: tool({
      description: "Reads a file at the specified path.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: ep("read_file", async ({ path }: { path: string }) => {
        const resolved = resolvePathInWorkspace(path);
        const content = await readFile(resolved, "utf-8");
        const lines = content.split("\n");
        const s = await stat(resolved);
        return JSON.stringify({ path: resolved, relativePath: relativePathInWorkspace(resolved), size: s.size, lineCount: lines.length, extension: extname(resolved), content });
      }),
    }),
    write_file: tool({
      description: "Creates or overwrites a file.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string(), content: z.string() }),
      execute: ep("write_file", async ({ path, content }: { path: string; content: string }) => {
        const resolved = resolvePathInWorkspace(path);
        await mkdir(dirname(resolved), { recursive: true });
        await writeFile(resolved, content, "utf-8");
        return JSON.stringify({
          path: resolved,
          relativePath: relativePathInWorkspace(resolved),
          size: Buffer.byteLength(content, "utf-8"),
          status: "written",
        });
      }),
    }),
    edit_file: tool({
      description: "Finds text in a file and replaces it with new content.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string(), oldString: z.string(), newString: z.string() }),
      execute: ep("edit_file", async ({ path, oldString, newString }: { path: string; oldString: string; newString: string }) => {
        const resolved = resolvePathInWorkspace(path);
        const content = await readFile(resolved, "utf-8");
        if (!content.includes(oldString)) return JSON.stringify({ error: "Text not found.", status: "failed" });
        const fi = content.indexOf(oldString);
        const li = content.lastIndexOf(oldString);
        if (fi !== li) return JSON.stringify({ error: "Multiple matches found.", status: "failed" });
        await writeFile(resolved, content.replace(oldString, newString), "utf-8");
        return JSON.stringify({ path: resolved, relativePath: relativePathInWorkspace(resolved), status: "edited" });
      }),
    }),
    delete_file: tool({
      description: "Permanently deletes a file.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: ep("delete_file", async ({ path }: { path: string }) => {
        const resolved = resolvePathInWorkspace(path);
        await unlink(resolved);
        return JSON.stringify({ path: resolved, status: "deleted" });
      }),
    }),
    list_directory: tool({
      description: "Lists files and directories at a path.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: ep("list_directory", async ({ path }: { path: string }) => {
        const resolved = resolvePathInWorkspace(path);
        const entries = await readdir(resolved, { withFileTypes: true });
        const items = await Promise.all(entries.map(async (entry) => {
          const fullPath = `${resolved}/${entry.name}`;
          let sz = 0;
          if (entry.isFile()) try { sz = (await stat(fullPath)).size; } catch {}
          return { name: entry.name, type: entry.isDirectory() ? "directory" : "file", size: sz, path: fullPath };
        }));
        return JSON.stringify({ path: resolved, items, totalItems: items.length });
      }),
    }),
    list_external_directory: tool({
      description: "Lists files at an absolute path outside the workspace.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: ep("list_external_directory", async ({ path }: { path: string }) => {
        try {
          const resolved = resolveExternalPath(path);
          const entries = await readdir(resolved, { withFileTypes: true });
          const items = await Promise.all(entries.map(async (entry) => {
            const fullPath = `${resolved}/${entry.name}`;
            let sz = 0;
            if (entry.isFile()) try { sz = (await stat(fullPath)).size; } catch {}
            return { name: entry.name, type: entry.isDirectory() ? "directory" : "file", size: sz, path: fullPath };
          }));
          return JSON.stringify({ path: resolved, items, totalItems: items.length });
        } catch (e) {
          return JSON.stringify({ error: (e as Error).message });
        }
      }),
    }),
    read_external_file: tool({
      description: "Reads a file at an absolute path outside the workspace.",
      inputSchema: z.object({ label: z.string().optional(), path: z.string() }),
      execute: ep("read_external_file", async ({ path }: { path: string }) => {
        try {
          const resolved = resolveExternalPath(path);
          const content = await readFile(resolved, "utf-8");
          const lines = content.split("\n");
          const s = await stat(resolved);
          return JSON.stringify({ path: resolved, size: s.size, lineCount: lines.length, extension: extname(resolved), content });
        } catch (e) {
          return JSON.stringify({ error: (e as Error).message });
        }
      }),
    }),
    run_command: tool({
      description: "Executes a shell command.",
      inputSchema: z.object({ label: z.string().optional(), command: z.string() }),
      execute: ep("run_command", async ({ command }: { command: string }) => {
        try {
          const { stdout, stderr } = await execAsync(command, { cwd: getWorkspacePath(), timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
          const generatedFiles = await scanGeneratedFiles();
          return JSON.stringify({ exitCode: 0, stdout, stderr, command, generatedFiles });
        } catch (error: any) {
          const generatedFiles = await scanGeneratedFiles();
          return JSON.stringify({ exitCode: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message ?? "Unknown", command, generatedFiles });
        }
      }),
    }),
  };

  const webTools: Record<string, any> = {
    web_search: tool({
      description: "Searches the web using DuckDuckGo.",
      inputSchema: z.object({ label: z.string().optional(), query: z.string() }),
      execute: ep("web_search", async ({ query }: { query: string }) => {
        const ddgs = new DDGS({ timeout: 8000 });
        const raw = await ddgs.text({ keywords: query, maxResults: 6 });
        const results = raw.map((r: { title: string; href: string; body: string }) => ({
          title: r.title,
          url: r.href && !r.href.startsWith("/") ? r.href : "",
          snippet: r.body.replace(/\s+/g, " ").trim().slice(0, 300),
        })).filter((r: { url: string }) => r.url);
        return JSON.stringify({ query, results, totalResults: results.length });
      }),
    }),
    web_fetch: tool({
      description: "Fetches a URL and returns its text content. Optionally pass a CSS selector to extract a specific section.",
      inputSchema: z.object({ label: z.string().optional(), url: z.string(), selector: z.string().optional() })
        .refine(({ url }) => {
          try { new URL(url); return true; } catch { return false; }
        }, { message: "Invalid URL" }),
      execute: ep("web_fetch", async ({ url, selector }: { url: string; selector?: string }) => {
        let targetUrl = url.trim();
        try {
          const parsed = new URL(targetUrl);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            return JSON.stringify({ url: targetUrl, error: `Unsupported protocol "${parsed.protocol}" — use http:// or https://`, status: 400 });
          }
        } catch {
          targetUrl = `https://${targetUrl.replace(/^https?:\/+/, "")}`;
        }
        const response = await fetch(targetUrl, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(30_000) });
        const raw = await response.text();
        const ct = response.headers.get("content-type") || "";
        const isText = ct.includes("text") || ct.includes("json") || ct.includes("xml") || ct.includes("html");
        let content = `[Binary: ${ct}]`;
        let truncated = false;
        if (isText) {
          if (selector) {
            const { JSDOM } = await import("jsdom");
            const dom = new JSDOM(raw);
            const elements = dom.window.document.querySelectorAll(selector);
            content = Array.from(elements).map((el: Element) => el.textContent?.trim?.() || "").filter(Boolean).join("\n\n");
            if (!content) content = `[No elements matched selector "${selector}"]`;
          } else {
            const articleMatch = raw.match(/<article[\s\S]*?<\/article>/i) || raw.match(/<main[\s\S]*?<\/main>/i) || raw.match(/id="mw-content-text"[\s\S]*?(?=<div class="printfooter"|$)/i) || raw.match(/id="bodyContent"[\s\S]*?(?=<div class="visualClear"|$)/i);
            const target = articleMatch ? articleMatch[0] : raw;
            content = target
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<nav[\s\S]*?<\/nav>/gi, "")
              .replace(/<header[\s\S]*?<\/header>/gi, "")
              .replace(/<footer[\s\S]*?<\/footer>/gi, "")
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .trim();
            if (content.length > 25_000) {
              content = content.slice(0, 25_000) + "\n\n[...truncated...]";
              truncated = true;
            }
          }
        }
        return JSON.stringify({ url: targetUrl, originalUrl: targetUrl !== url.trim() ? url.trim() : undefined, status: response.status, contentType: ct, content, truncated, size: raw.length, selectorUsed: selector });
      }),
    }),
  };

  const memoryTools: Record<string, any> = {
    list_sessions: tool({
      description: "Lists past sessions with titles and dates.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () => JSON.stringify({ sessions: await listSessions() }),
    }),
    read_session_summary: tool({
      description: "Reads the summary of a past session.",
      inputSchema: z.object({ label: z.string().optional(), sessionId: z.string() }),
      execute: async ({ sessionId }: { sessionId: string }) => {
        const s = await readSessionSummary(sessionId);
        return JSON.stringify({ session: s || { error: "Not found." } });
      },
    }),
    read_session: tool({
      description: "Reads the full transcript of a past session.",
      inputSchema: z.object({ label: z.string().optional(), sessionId: z.string() }),
      execute: async ({ sessionId }: { sessionId: string }) => {
        const s = await readSession(sessionId);
        return JSON.stringify({ session: s || { error: "Not found." } });
      },
    }),
    read_memory: tool({
      description: "Reads persistent memory across sessions.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () => JSON.stringify({ entries: await getMemoryEntries() }),
    }),
  };

  const taskTools: Record<string, any> = {
    schedule_task: tool({
      description: "Create, edit, delete, list, or immediately trigger scheduled tasks. Actions: create | edit | delete | list | trigger. For 'create': provide name, instructions, scheduleKind (interval/once), intervalMinutes or runAt, and optional permissions. For 'edit': provide task_id and fields to update. For 'delete': provide task_id. For 'list': no extra fields. For 'trigger': provide task_id.",
      inputSchema: z.object({
        action: z.enum(["create", "edit", "delete", "list", "trigger"]),
        task_id: z.string().optional(),
        name: z.string().optional(),
        instructions: z.string().optional(),
        schedule_kind: z.enum(["interval", "once"]).optional(),
        interval_minutes: z.number().optional(),
        run_at: z.string().optional(),
        permissions: z.object({
          runCommands: z.boolean().optional(),
          destructiveCommands: z.boolean().optional(),
          externalFiles: z.boolean().optional(),
          webAccess: z.boolean().optional(),
          browserAccess: z.boolean().optional(),
        }).optional(),
      }),
      execute: async ({ action, task_id, name, instructions, schedule_kind, interval_minutes, run_at, permissions }) => {
        try {
          switch (action) {
            case "create": {
              if (!name || !instructions || !schedule_kind) {
                return JSON.stringify({ error: "name, instructions, and schedule_kind are required for create" });
              }
              const task = await createTask({
                name, instructions, scheduleKind: schedule_kind,
                intervalMinutes: interval_minutes,
                runAt: run_at ? new Date(run_at).getTime() : undefined,
                permissions,
              });
              return JSON.stringify({ task, message: `Task "${name}" created. It will run ${schedule_kind === "interval" ? `every ${interval_minutes || 30} minutes` : `once on ${run_at}`}.` });
            }
            case "edit": {
              if (!task_id) return JSON.stringify({ error: "task_id is required for edit" });
              const patch: any = {};
              if (name !== undefined) patch.name = name;
              if (instructions !== undefined) patch.instructions = instructions;
              if (schedule_kind !== undefined) {
                patch.schedule = {
                  kind: schedule_kind,
                  intervalMinutes: interval_minutes,
                  runAt: run_at ? new Date(run_at).getTime() : undefined,
                };
              }
              if (permissions !== undefined) patch.permissions = permissions;
              const updated = await updateTask(task_id, patch);
              if (!updated) return JSON.stringify({ error: "Task not found" });
              return JSON.stringify({ task: updated, message: `Task "${updated.name}" updated.` });
            }
            case "delete": {
              if (!task_id) return JSON.stringify({ error: "task_id is required for delete" });
              const ok = await deleteTask(task_id);
              if (!ok) return JSON.stringify({ error: "Task not found or heartbeat cannot be deleted" });
              return JSON.stringify({ message: "Task deleted." });
            }
            case "list": {
              const tasks = await getTasks();
              const list = tasks.map((t) => ({
                id: t.id,
                name: t.name,
                type: t.type,
                enabled: t.enabled,
                schedule: t.schedule,
                lastRunAt: t.lastRunAt,
                nextRunAt: t.nextRunAt,
              }));
              return JSON.stringify({ tasks: list });
            }
            case "trigger": {
              if (!task_id) return JSON.stringify({ error: "task_id is required for trigger" });
              const task = await getTask(task_id);
              if (!task) return JSON.stringify({ error: "Task not found" });
              const result = await executeTask(task);
              await updateTaskRunTime(task.id, result.status === "success");
              const summary = result.output.slice(0, 200);
              return JSON.stringify({ message: `Task "${task.name}" executed: ${result.status}`, output: summary });
            }
            default:
              return JSON.stringify({ error: `Unknown action: ${action}` });
          }
        } catch (error) {
          return JSON.stringify({ error: String(error) });
        }
      },
    }),
    update_heartbeat: tool({
      description: "Update the heartbeat task's instructions or interval. This is the system task that wakes the agent every N minutes.",
      inputSchema: z.object({
        instructions: z.string().optional(),
        interval_minutes: z.number().min(1).max(1440).optional(),
      }),
      execute: async ({ instructions, interval_minutes }) => {
        try {
          const patch: any = {};
          if (instructions !== undefined) patch.instructions = instructions;
          if (interval_minutes !== undefined) {
            patch.schedule = { kind: "interval", intervalMinutes: interval_minutes };
          }
          const task = await updateTask("heartbeat", patch);
          if (!task) return JSON.stringify({ error: "Heartbeat task not found" });
          return JSON.stringify({ task, message: "Heartbeat updated." });
        } catch (error) {
          return JSON.stringify({ error: String(error) });
        }
      },
    }),
  };

  const interactionTools: Record<string, any> = {
    ask_user: tool({
      description: "Asks the user a question. Only use when you cannot proceed without clarification — default to making reasonable decisions yourself.",
      inputSchema: z.object({ label: z.string().optional(), question: z.string(), options: z.array(z.string()).optional(), multiple: z.boolean().optional() }),
      execute: async ({ question, options, multiple }: { question: string; options?: string[]; multiple?: boolean }) => {
        const rid = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const answer = await createPendingQuestion(rid, question, options, threadId, multiple);
        return JSON.stringify({ question, options, multiple, answer });
      },
    }),
    connect_service: tool({
      description: "Generates an OAuth connection link so the user can connect an external service (Gmail, Slack, GitHub, Notion, Linear, etc.). Use this whenever a connector tool fails because the service isn't connected yet, or when the user asks to connect/reconnect a service.",
      inputSchema: z.object({
        label: z.string().optional(),
        connectorId: z.string().describe("The connector/toolkit ID to connect. Use one of: linear, atlassian, trello, airtable, notion, slack, github, google, hubspot, asana, dropbox, canva"),
      }),
      execute: async ({ connectorId }: { connectorId: string }) => {
        try {
          const uid = config.instanceId || DEFAULT_USER_ID;
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:1420";
          const callbackUrl = `${baseUrl}/connectors/callback`;
          const redirectUrl = await initiateConnection(connectorId, uid, callbackUrl);
          if (!redirectUrl) {
            return JSON.stringify({ error: `No auth config found for "${connectorId}". Make sure it's configured in the Composio dashboard.` });
          }
          return JSON.stringify({ connectUrl: redirectUrl, message: `Click the link to connect ${connectorId}: ${redirectUrl}` });
        } catch (e) {
          return JSON.stringify({ error: String(e) });
        }
      },
    }),
  };

  // Base tools shared by main and subagent (subagent gets same access, minus subagent itself to avoid recursion)
  const baseTools: Record<string, any> = {
    ...fileTools,
    ...webTools,
    ...memoryTools,
    ...taskTools,
    ...interactionTools,
    ...browserTools,
    ...computerTools,
    ...composioTools,
    ...interactionTools,
  };
  // Include connect_service explicitly (already in interactionTools) but keep for clarity
  Object.assign(baseTools, interactionTools);

  const subagentTool: Record<string, any> = {
    subagent: tool({
      description: "Spawns an isolated subagent worker to execute a specialized sub-task (e.g. coding, research, review, architecture design). Displays subagent thoughts & actions in the UI. Subagents have full tool access and will report what is missing.",
      inputSchema: z.object({
        label: z.string().optional(),
        title: z.string().describe("Short title of the subagent task (e.g. 'Analyzing API endpoints', 'Generating Navbar Component')"),
        description: z.string().describe("1-phrase description of what the subagent has to do"),
        subagentType: z.enum(["coder", "researcher", "reviewer", "architect", "general"]).default("general"),
        task: z.string().describe("Detailed task prompt for the subagent"),
      }),
      execute: ep("subagent", async ({ title, description, subagentType, task }: { title: string; description: string; subagentType?: string; task: string }) => {
        try {
          const subModel = resolveModelClient(config.modelName || "");
          const subSystemPrompt = buildSubagentSystemPrompt(task, title, description, subagentType || "general");
          // Subagent gets same base tools (without subagent recursion)
          const subTools = baseTools;

          const subResult = await generateText({
            model: subModel,
            system: subSystemPrompt,
            prompt: task,
            tools: subTools as any,
            maxRetries: 0,
            stopWhen: async ({ steps }: { steps: any[] }) => steps.length >= 12,
            temperature: config.temperature !== undefined ? config.temperature : 0.7,
            ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
          });

          // Build UI steps in a format SubagentToolUI can render identically to main agent
          const uiSteps: Array<{ type: "thought" | "tool" | "text"; content: string; toolName?: string; args?: any; result?: any }> = [];
          for (const step of subResult.steps) {
            if (step.reasoningText) {
              uiSteps.push({ type: "thought", content: step.reasoningText });
            }
            const toolCalls: any[] = (step as any).toolCalls || [];
            const toolResults: any[] = (step as any).toolResults || [];
            for (const tc of toolCalls) {
              const matchingResult = toolResults.find((r: any) => r.toolCallId === tc.toolCallId);
              // AI SDK v5 uses `input` for args, older uses `args`
              const inputVal = (tc as any).input ?? (tc as any).args ?? {};
              let content: string;
              try {
                content = typeof inputVal === "string" ? inputVal : JSON.stringify(inputVal);
              } catch {
                content = String(inputVal);
              }
              const outputVal = (matchingResult as any)?.output ?? (matchingResult as any)?.result ?? (matchingResult as any)?.value ?? null;
              uiSteps.push({
                type: "tool",
                toolName: tc.toolName,
                content,
                args: inputVal,
                result: outputVal,
              });
            }
            // Capture pure text steps (when no tool calls)
            if (step.text && toolCalls.length === 0 && step.text.trim() && step.text.trim() !== subResult.text.trim()) {
              uiSteps.push({ type: "text", content: step.text });
            }
          }

          return JSON.stringify({
            title,
            description,
            subagentType: subagentType || "general",
            status: "completed",
            summary: subResult.text,
            steps: uiSteps,
            task,
            toolsUsed: [...new Set(uiSteps.filter(s => s.type === "tool").map(s => s.toolName))],
          });
        } catch (err: any) {
          return JSON.stringify({
            title,
            description,
            subagentType: subagentType || "general",
            status: "failed",
            error: err?.message || String(err),
            summary: err?.message || String(err),
            steps: [],
            task,
          });
        }
      }),
    }),
  };

  const mainTools = {
    ...baseTools,
    ...subagentTool,
  } as any;

  const result = streamText({
    model: resolveModelClient(config.modelName || ""),
    system: systemPrompt,
    messages: config.messages as any,
    maxRetries: 0,
    stopWhen: async ({ steps }: { steps: any[] }) => {
      if (steps.length >= 15) return true;
      return false;
    },
    temperature: config.temperature !== undefined ? config.temperature : 0.7,
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),

    tools: mainTools,
  });

  return result;
}
