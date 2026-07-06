import { streamText, tool } from "ai";
import { z } from "zod";
import { cerebras, resolveCerebrasModel, toCerebrasModelId } from "./cerebras";
import { DDGS } from "@phukon/duckduckgo-search";
import { JSDOM } from "jsdom";
import { buildSystemPrompt } from "./system-prompt";
import { readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { withPermissionCheck } from "@/lib/middleware/permission-middleware";
import { getWorkspacePath, resolvePathInWorkspace, relativePathInWorkspace, resolveExternalPath } from "@/lib/middleware/workspace";
import { createPendingQuestion } from "./tools/ask-user-tool";
import { generateMemoryContext } from "./memory-agent";
import { listSessions, readSessionSummary, readSession } from "@/lib/memory/session-store";
import { getMemoryEntries } from "@/lib/memory/memory-store";

const execAsync = promisify(exec);

const DOWNLOADABLE_EXTS = new Set(['.pptx', '.docx', '.xlsx', '.pdf', '.csv', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.svg']);

async function scanGeneratedFiles() {
  const ws = getWorkspacePath();
  const files = await readdir(ws);
  const generated: Array<{ name: string; relativePath: string; size: number }> = [];
  const now = Date.now();
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!DOWNLOADABLE_EXTS.has(ext)) continue;
    try {
      const full = join(ws, file);
      const s = await stat(full);
      const birth = s.birthtime?.getTime() || s.ctime.getTime();
      if (now - birth < 120_000) {
        generated.push({ name: file, relativePath: relativePathInWorkspace(full), size: s.size });
      }
    } catch {}
  }
  return generated;
}

export type AgentConfig = {
  systemPrompt?: string;
  messages: Array<Record<string, unknown>>;
  threadId?: string;
  modelName?: string;
  customSystemPrompt?: string;
  temperature?: number;
};

export async function createAgent(config: AgentConfig) {
  const threadId = config.threadId || `thread_${Date.now()}`;
  const memoryContext = await generateMemoryContext();
  const basePrompt = buildSystemPrompt(memoryContext);
  const systemPrompt = config.systemPrompt || (config.customSystemPrompt 
    ? `${basePrompt}\n\n## Custom System Instructions\n\n${config.customSystemPrompt}`
    : basePrompt);

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

  const resolvedModel = resolveCerebrasModel(config.modelName);

  const result = streamText({
    model: cerebras.chat(toCerebrasModelId(resolvedModel)),
    system: systemPrompt,
    messages: config.messages as any,
    stopWhen: async ({ steps }: { steps: any[] }) => {
      if (steps.length >= 15) return true;
      return false;
    },
    timeout: 15_000,
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

      ask_user: tool({
        description: "Asks the user a question. Must use before creating presentations or content.",
        inputSchema: z.object({ label: z.string().optional(), question: z.string(), options: z.array(z.string()).optional(), multiple: z.boolean().optional() }),
        execute: async ({ question, options, multiple }: { question: string; options?: string[]; multiple?: boolean }) => {
          const rid = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const answer = await createPendingQuestion(rid, question, options, threadId, multiple);
          return JSON.stringify({ question, options, multiple, answer });
        },
      }),
    }) as any,
  });

  return result;
}
