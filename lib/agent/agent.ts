import { streamText, tool } from "ai";
import { z } from "zod";
import { createModelClient } from "./model-client";
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
import { createComputerTools } from "./computer/computer-tools";
import { detectModelImageSupport } from "@/components/shared/settings-dialog";

const execAsync = promisify(exec);

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
};

export async function createAgent(config: AgentConfig) {
  const threadId = config.threadId || `thread_${Date.now()}`;
  const memoryContext = await generateMemoryContext();
  const basePrompt = buildSystemPrompt(memoryContext);

  let userInfoSection = "";
  if (config.userName || config.userAbout) {
    const parts: string[] = [];
    if (config.userName) parts.push(`User name: ${config.userName}`);
    if (config.userAbout) parts.push(`About the user: ${config.userAbout}`);
    userInfoSection = `\n\n## User Context\n\n${parts.join("\n")}`;
  }

  const systemPrompt = config.systemPrompt || (
    config.customSystemPrompt
      ? `${basePrompt}${userInfoSection}\n\n## Custom System Instructions\n\n${config.customSystemPrompt}`
      : `${basePrompt}${userInfoSection}`
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

  const result = streamText({
    model: createModelClient(config.modelName || ""),
    system: systemPrompt,
    messages: config.messages as any,
    maxRetries: 0,
    stopWhen: async ({ steps }: { steps: any[] }) => {
      if (steps.length >= 15) return true;
      return false;
    },
    temperature: config.temperature !== undefined ? config.temperature : 0.7,

    tools: ({
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

      ask_user: tool({
        description: "Asks the user a question. Only use when you cannot proceed without clarification — default to making reasonable decisions yourself.",
        inputSchema: z.object({ label: z.string().optional(), question: z.string(), options: z.array(z.string()).optional(), multiple: z.boolean().optional() }),
        execute: async ({ question, options, multiple }: { question: string; options?: string[]; multiple?: boolean }) => {
          const rid = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const answer = await createPendingQuestion(rid, question, options, threadId, multiple);
          return JSON.stringify({ question, options, multiple, answer });
        },
      }),

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
  });

  return result;
}
