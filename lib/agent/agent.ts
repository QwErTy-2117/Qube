import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { mistral } from "@ai-sdk/mistral";
import { buildSystemPrompt } from "./system-prompt";
import { readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { withPermissionCheck } from "@/lib/middleware/permission-middleware";
import { getWorkspacePath } from "@/lib/middleware/workspace";
import { createPendingQuestion } from "./tools/ask-user-tool";
import { generateMemoryContext } from "./memory-agent";
import { listSessions, readSessionSummary, readSession } from "@/lib/memory/session-store";
import { getMemoryEntries } from "@/lib/memory/memory-store";

const execAsync = promisify(exec);
const MODEL = process.env.LLM_MODEL || "mistral-large-latest";

export type AgentConfig = {
  systemPrompt?: string;
  messages: Array<Record<string, unknown>>;
  threadId?: string;
};

export async function createAgent(config: AgentConfig) {
  const threadId = config.threadId || `thread_${Date.now()}`;
  const memoryContext = await generateMemoryContext();
  const systemPrompt = config.systemPrompt || buildSystemPrompt(memoryContext);

  const ep = (name: string, fn: (...args: any[]) => Promise<string>) => {
    return async (...args: any[]) => {
      const input = typeof args[0] === "object" && args[0] !== null ? args[0] : {};
      return withPermissionCheck(name, input, threadId, () => fn(input));
    };
  };

  const result = streamText({
    model: mistral(MODEL),
    system: systemPrompt,
    messages: config.messages as any,
    stopWhen: stepCountIs(15),

    tools: ({
      read_file: tool({
        description: "Reads and returns the contents of a file at the specified path.",
        inputSchema: z.object({ path: z.string() }),
        execute: ep("read_file", async ({ path }: { path: string }) => {
          const resolved = resolve(path);
          const content = await readFile(resolved, "utf-8");
          const lines = content.split("\n");
          const s = await stat(resolved);
          return JSON.stringify({ path: resolved, size: s.size, lineCount: lines.length, extension: extname(resolved), content });
        }),
      }),

      write_file: tool({
        description: "Creates or overwrites a file with the specified content.",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: ep("write_file", async ({ path, content }: { path: string; content: string }) => {
          const resolved = resolve(path);
          await writeFile(resolved, content, "utf-8");
          return JSON.stringify({ path: resolved, size: Buffer.byteLength(content, "utf-8"), status: "written" });
        }),
      }),

      edit_file: tool({
        description: "Finds text in a file and replaces it with new content.",
        inputSchema: z.object({ path: z.string(), oldString: z.string(), newString: z.string() }),
        execute: ep("edit_file", async ({ path, oldString, newString }: { path: string; oldString: string; newString: string }) => {
          const resolved = resolve(path);
          const content = await readFile(resolved, "utf-8");
          if (!content.includes(oldString)) return JSON.stringify({ error: "Text not found.", status: "failed" });
          const fi = content.indexOf(oldString);
          const li = content.lastIndexOf(oldString);
          if (fi !== li) return JSON.stringify({ error: "Multiple matches found.", status: "failed" });
          await writeFile(resolved, content.replace(oldString, newString), "utf-8");
          return JSON.stringify({ path: resolved, status: "edited" });
        }),
      }),

      delete_file: tool({
        description: "Permanently deletes a file.",
        inputSchema: z.object({ path: z.string() }),
        execute: ep("delete_file", async ({ path }: { path: string }) => {
          const resolved = resolve(path);
          await unlink(resolved);
          return JSON.stringify({ path: resolved, status: "deleted" });
        }),
      }),

      list_directory: tool({
        description: "Lists files and directories at a path.",
        inputSchema: z.object({ path: z.string() }),
        execute: ep("list_directory", async ({ path }: { path: string }) => {
          const resolved = resolve(path);
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

      run_command: tool({
        description: "Executes a shell command and returns its output.",
        inputSchema: z.object({ command: z.string(), cwd: z.string().optional() }),
        execute: ep("run_command", async ({ command, cwd }: { command: string; cwd?: string }) => {
          try {
            const { stdout, stderr } = await execAsync(command, { cwd: cwd || getWorkspacePath(), timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
            return JSON.stringify({ exitCode: 0, stdout, stderr, command });
          } catch (error: any) {
            return JSON.stringify({ exitCode: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message ?? "Unknown", command });
          }
        }),
      }),

      web_search: tool({
        description: "Searches the web.",
        inputSchema: z.object({ query: z.string() }),
        execute: ep("web_search", async ({ query }: { query: string }) => {
          const body = new URLSearchParams({ q: query });
          const response = await fetch("https://html.duckduckgo.com/html/", {
            method: "POST",
            body,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; Qube/1.0)" },
          });
          const html = await response.text();
          const results: Array<{ title: string; snippet: string; url: string }> = [];
          const resultRegex = /<h2[^>]*class="result__title"[^>]*>.*?<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>.*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;
          let match;
          while ((match = resultRegex.exec(html)) !== null) {
            results.push({
              url: match[1].startsWith("//") ? "https:" + match[1] : match[1],
              title: match[2].replace(/<[^>]*>/g, "").trim(),
              snippet: match[3].replace(/<[^>]*>/g, "").trim(),
            });
          }
          return JSON.stringify({ query, results: results.slice(0, 4), totalResults: results.length });
        }),
      }),

      web_fetch: tool({
        description: "Fetches a URL and returns its text content.",
        inputSchema: z.object({ url: z.string().url() }),
        execute: ep("web_fetch", async ({ url }: { url: string }) => {
          const response = await fetch(url, { headers: { "User-Agent": "Qube/1.0" }, signal: AbortSignal.timeout(30_000) });
          const text = await response.text();
          const ct = response.headers.get("content-type") || "";
          const isText = ct.includes("text") || ct.includes("json") || ct.includes("xml") || ct.includes("html");
          return JSON.stringify({ url, status: response.status, contentType: ct, content: isText ? text.slice(0, 100_000) : `[Binary: ${ct}]`, size: text.length });
        }),
      }),

      list_sessions: tool({
        description: "Lists past sessions with titles and dates.",
        inputSchema: z.object({}),
        execute: async () => JSON.stringify({ sessions: await listSessions() }),
      }),

      read_session_summary: tool({
        description: "Reads the summary of a past session.",
        inputSchema: z.object({ sessionId: z.string() }),
        execute: async ({ sessionId }: { sessionId: string }) => {
          const s = await readSessionSummary(sessionId);
          return JSON.stringify({ session: s || { error: "Not found." } });
        },
      }),

      read_session: tool({
        description: "Reads the full transcript of a past session.",
        inputSchema: z.object({ sessionId: z.string() }),
        execute: async ({ sessionId }: { sessionId: string }) => {
          const s = await readSession(sessionId);
          return JSON.stringify({ session: s || { error: "Not found." } });
        },
      }),

      read_memory: tool({
        description: "Reads persistent memory across sessions.",
        inputSchema: z.object({}),
        execute: async () => JSON.stringify({ entries: await getMemoryEntries() }),
      }),

      ask_user: tool({
        description: "Asks the user a clarifying question. Use when you need more information.",
        inputSchema: z.object({ question: z.string(), options: z.array(z.string()).optional() }),
        execute: async ({ question, options }: { question: string; options?: string[] }) => {
          const rid = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          return JSON.stringify({ question, answer: await createPendingQuestion(rid, question, options, threadId) });
        },
      }),
    }) as any,
  });

  return result;
}
