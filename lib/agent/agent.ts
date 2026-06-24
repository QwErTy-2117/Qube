import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { mistral } from "@ai-sdk/mistral";
import { buildSystemPrompt } from "./system-prompt";
import { readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { withPermissionCheck } from "@/lib/middleware/permission-middleware";
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
            const { stdout, stderr } = await execAsync(command, { cwd: cwd || undefined, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
            return JSON.stringify({ exitCode: 0, stdout, stderr, command });
          } catch (error: any) {
            return JSON.stringify({ exitCode: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message ?? "Unknown", command });
          }
        }),
      }),

      web_search: tool({
        description: "Searches the web using DuckDuckGo.",
        inputSchema: z.object({ query: z.string() }),
        execute: ep("web_search", async ({ query }: { query: string }) => {
          const response = await fetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
            { headers: { "User-Agent": "Qube/1.0" } },
          );
          const data: any = await response.json();
          const results: Array<{ title: string; snippet: string; url: string }> = [];
          if (data.AbstractText) results.push({ title: data.AbstractSource || "Result", snippet: data.AbstractText, url: data.AbstractURL || "" });
          if (data.RelatedTopics) {
            for (const topic of data.RelatedTopics) {
              if (topic.Topics) { for (const sub of topic.Topics) { if (sub.Text) results.push({ title: sub.Text.split(" - ")[0], snippet: sub.Text, url: sub.FirstURL || "" }); } }
              else if (topic.Text) results.push({ title: topic.Text.split(" - ")[0], snippet: topic.Text, url: topic.FirstURL || "" });
            }
          }
          return JSON.stringify({ query, results, totalResults: results.length });
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

      create_excel: tool({
        description: "Creates an Excel spreadsheet (.xlsx) from data.",
        inputSchema: z.object({ filename: z.string(), data: z.array(z.record(z.string(), z.any())), sheetName: z.string().optional() }),
        execute: ep("create_excel", async ({ filename, data, sheetName }: { filename: string; data: Record<string, any>[]; sheetName?: string }) => {
          const { utils, write } = await import("xlsx");
          const wb = utils.book_new();
          utils.book_append_sheet(wb, utils.json_to_sheet(data), sheetName || "Sheet1");
          await writeFile(resolve(filename), new Uint8Array(write(wb, { type: "buffer", bookType: "xlsx" })));
          return JSON.stringify({ path: resolve(filename), rows: data.length });
        }),
      }),

      create_docx: tool({
        description: "Creates a Word document (.docx).",
        inputSchema: z.object({ filename: z.string(), title: z.string(), sections: z.array(z.object({ heading: z.string(), content: z.string() })) }),
        execute: ep("create_docx", async ({ filename, title, sections }: { filename: string; title: string; sections: Array<{ heading: string; content: string }> }) => {
          const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx");
          const children: any[] = [
            new Paragraph({ text: title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
            new Paragraph({ spacing: { after: 200 } }),
          ];
          for (const s of sections) {
            children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }));
            children.push(new Paragraph({ children: [new TextRun({ text: s.content, size: 24 })], spacing: { after: 200 } }));
          }
          const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
          await writeFile(resolve(filename), buffer);
          return JSON.stringify({ path: resolve(filename), title, sectionCount: sections.length });
        }),
      }),

      create_pptx: tool({
        description: "Creates a PowerPoint presentation (.pptx).",
        inputSchema: z.object({ filename: z.string(), title: z.string(), slides: z.array(z.object({ title: z.string(), bullets: z.array(z.string()) })) }),
        execute: ep("create_pptx", async ({ filename, title, slides }: { filename: string; title: string; slides: Array<{ title: string; bullets: string[] }> }) => {
          const pptxgen = await import("pptxgenjs");
          const pres = new pptxgen.default();
          pres.addSlide().addText(title, { x: 1, y: 1, w: 8, h: 1, fontSize: 36, bold: true, color: "333333", align: "center" as any });
          for (const s of slides) {
            const slide = pres.addSlide();
            slide.addText(s.title, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true, color: "333333" });
            slide.addText(s.bullets.map((b: string) => `• ${b}`).join("\n"), { x: 0.5, y: 1.3, w: 9, h: 5, fontSize: 18, color: "555555", valign: "top" as any, align: "left" as any });
          }
          const buffer = await pres.write({ outputType: "nodebuffer" }) as Buffer;
          await writeFile(resolve(filename), buffer);
          return JSON.stringify({ path: resolve(filename), title, slides: slides.length });
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
