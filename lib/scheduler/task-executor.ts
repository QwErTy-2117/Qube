import { streamText, tool } from "ai";
import { z } from "zod";
import { zen, resolveZenModel } from "@/lib/agent/zen";
import { type ScheduledTask } from "./types";
import { appendLog } from "./task-log";
import { createTaskPermissionChecker } from "@/lib/middleware/permission-middleware";
import { readFile, writeFile, unlink, readdir, stat, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  getWorkspacePath,
  resolvePathInWorkspace,
  relativePathInWorkspace,
  resolveExternalPath,
} from "@/lib/middleware/workspace";
import { DDGS } from "@phukon/duckduckgo-search";
import { JSDOM } from "jsdom";
import { extname, join, dirname } from "node:path";
import { getMemoryEntries } from "@/lib/memory/memory-store";

const execAsync = promisify(exec);

async function scanGeneratedFiles() {
  const ws = getWorkspacePath();
  const generated: Array<{
    name: string;
    relativePath: string;
    size: number;
  }> = [];
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
          if ([".pptx", ".docx", ".xlsx", ".pdf", ".csv", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg"].includes(ext)) {
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

function buildTaskSystemPrompt(task: ScheduledTask): string {
  return `You are a background autonomous task named "${task.name}". You run without user supervision.

## Your Task
${task.instructions}

## Available Tools
- write_file: Create or overwrite a file (path, content)
- read_file: Read a file's contents (path)
- edit_file: Find and replace text in a file (path, oldString, newString)
- delete_file: Delete a file (path)
- run_command: Execute a shell command (command)
- list_directory: List files in a directory (path)
- web_search: Search the web (query)
- web_fetch: Fetch a URL and get text content (url, optional selector)
- read_memory: Read persistent memory entries

## Workspace Organization
To keep the workspace clean and well-organized, you MUST save all generated files inside structured subdirectories instead of placing them directly at the workspace root. Do not dump a mix of raw files at the root level.
Use the following folder structure:
- documents/ — For text files, markdown files, and Word documents (e.g. .txt, readme.md, .docx, .pdf).
- presentations/ — For presentation slides (e.g. .pptx).
- spreadsheets/ — For Excel files and CSV datasets (e.g. .xlsx, .csv).
- images/ — For generated or downloaded graphics, diagrams, and image assets (e.g. .png, .jpg, .jpeg, .gif, .svg).
- code/ — For any scripts, source files, and utility code (e.g. .py, .js, .cjs, .sh, .ts).

Rules for writing files:
1. When calling write_file, ALWAYS prefix your file paths with the appropriate category folder name (e.g., presentations/my_slides.pptx or documents/apple_pie_recipe.txt instead of my_slides.pptx or apple_pie_recipe.txt).
2. If you are executing a command/script (via run_command) that automatically writes/generates files, configure the script to output those files into these specific directories.
3. When referencing these files in your final response or using them, always use their full structured path (e.g. [file: presentations/my_slides.pptx]).

## Rules
- Do NOT ask the user any questions. Work autonomously.
- You MUST call the tools to actually do the work. Do NOT just describe what you would do — execute the tools.
- After using the tools, provide a concise summary of what you did.`;
}

export async function executeTask(
  task: ScheduledTask,
): Promise<{
  status: "success" | "error";
  output: string;
  duration: number;
}> {
  const startTime = Date.now();
  const threadId = `task_${task.id}`;
  const checkPermission = createTaskPermissionChecker(task.permissions);

  const wrap = (name: string, fn: (args: any) => Promise<string>) => {
    return async (...args: any[]) => {
      const input =
        typeof args[0] === "object" && args[0] !== null ? args[0] : {};
      const { allowed, reason } = checkPermission(name, input);
      if (!allowed)
        return JSON.stringify({
          error: true,
          tool: name,
          message: reason,
        });
      try {
        return await fn(input);
      } catch (err) {
        const msg =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        return JSON.stringify({ error: true, tool: name, message: msg });
      }
    };
  };

  const baseTools: Record<string, any> = {
    read_file: tool({
      description: "Reads a file at the specified path.",
      inputSchema: z.object({
        label: z.string().optional(),
        path: z.string(),
      }),
      execute: wrap(
        "read_file",
        async ({ path }: { path: string }) => {
          const resolved = resolvePathInWorkspace(path);
          const content = await readFile(resolved, "utf-8");
          const lines = content.split("\n");
          const s = await stat(resolved);
          return JSON.stringify({
            path: resolved,
            relativePath: relativePathInWorkspace(resolved),
            size: s.size,
            lineCount: lines.length,
            extension: extname(resolved),
            content,
          });
        },
      ),
    }),

    write_file: tool({
      description: "Creates or overwrites a file.",
      inputSchema: z.object({
        label: z.string().optional(),
        path: z.string(),
        content: z.string(),
      }),
      execute: wrap(
        "write_file",
        async ({
          path,
          content,
        }: {
          path: string;
          content: string;
        }) => {
          const resolved = resolvePathInWorkspace(path);
          await mkdir(dirname(resolved), { recursive: true });
          await writeFile(resolved, content, "utf-8");
          return JSON.stringify({
            path: resolved,
            relativePath: relativePathInWorkspace(resolved),
            size: Buffer.byteLength(content, "utf-8"),
            status: "written",
          });
        },
      ),
    }),

    edit_file: tool({
      description: "Finds text in a file and replaces it with new content.",
      inputSchema: z.object({
        label: z.string().optional(),
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
      }),
      execute: wrap(
        "edit_file",
        async ({
          path,
          oldString,
          newString,
        }: {
          path: string;
          oldString: string;
          newString: string;
        }) => {
          const resolved = resolvePathInWorkspace(path);
          const content = await readFile(resolved, "utf-8");
          if (!content.includes(oldString))
            return JSON.stringify({ error: "Text not found.", status: "failed" });
          const fi = content.indexOf(oldString);
          const li = content.lastIndexOf(oldString);
          if (fi !== li)
            return JSON.stringify({
              error: "Multiple matches found.",
              status: "failed",
            });
          await writeFile(resolved, content.replace(oldString, newString), "utf-8");
          return JSON.stringify({
            path: resolved,
            relativePath: relativePathInWorkspace(resolved),
            status: "edited",
          });
        },
      ),
    }),

    delete_file: tool({
      description: "Permanently deletes a file.",
      inputSchema: z.object({
        label: z.string().optional(),
        path: z.string(),
      }),
      execute: wrap(
        "delete_file",
        async ({ path }: { path: string }) => {
          const resolved = resolvePathInWorkspace(path);
          await unlink(resolved);
          return JSON.stringify({ path: resolved, status: "deleted" });
        },
      ),
    }),

    list_directory: tool({
      description: "Lists files and directories at a path.",
      inputSchema: z.object({
        label: z.string().optional(),
        path: z.string(),
      }),
      execute: wrap(
        "list_directory",
        async ({ path }: { path: string }) => {
          const resolved = resolvePathInWorkspace(path);
          const entries = await readdir(resolved, { withFileTypes: true });
          const items = await Promise.all(
            entries.map(async (entry) => {
              const fullPath = `${resolved}/${entry.name}`;
              let sz = 0;
              if (entry.isFile())
                try {
                  sz = (await stat(fullPath)).size;
                } catch {}
              return {
                name: entry.name,
                type: entry.isDirectory() ? "directory" : "file",
                size: sz,
                path: fullPath,
              };
            }),
          );
          return JSON.stringify({
            path: resolved,
            items,
            totalItems: items.length,
          });
        },
      ),
    }),

    list_external_directory: tool({
      description:
        "Lists files at an absolute path outside the workspace.",
      inputSchema: z.object({
        label: z.string().optional(),
        path: z.string(),
      }),
      execute: wrap(
        "list_external_directory",
        async ({ path }: { path: string }) => {
          try {
            const resolved = resolveExternalPath(path);
            const entries = await readdir(resolved, { withFileTypes: true });
            const items = await Promise.all(
              entries.map(async (entry) => {
                const fullPath = `${resolved}/${entry.name}`;
                let sz = 0;
                if (entry.isFile())
                  try {
                    sz = (await stat(fullPath)).size;
                  } catch {}
                return {
                  name: entry.name,
                  type: entry.isDirectory() ? "directory" : "file",
                  size: sz,
                  path: fullPath,
                };
              }),
            );
            return JSON.stringify({ path: resolved, items, totalItems: items.length });
          } catch (e) {
            return JSON.stringify({ error: (e as Error).message });
          }
        },
      ),
    }),

    read_external_file: tool({
      description:
        "Reads a file at an absolute path outside the workspace.",
      inputSchema: z.object({
        label: z.string().optional(),
        path: z.string(),
      }),
      execute: wrap(
        "read_external_file",
        async ({ path }: { path: string }) => {
          try {
            const resolved = resolveExternalPath(path);
            const content = await readFile(resolved, "utf-8");
            const lines = content.split("\n");
            const s = await stat(resolved);
            return JSON.stringify({
              path: resolved,
              size: s.size,
              lineCount: lines.length,
              extension: extname(resolved),
              content,
            });
          } catch (e) {
            return JSON.stringify({ error: (e as Error).message });
          }
        },
      ),
    }),

    run_command: tool({
      description: "Executes a shell command.",
      inputSchema: z.object({
        label: z.string().optional(),
        command: z.string(),
      }),
      execute: wrap(
        "run_command",
        async ({ command }: { command: string }) => {
          try {
            const { stdout, stderr } = await execAsync(command, {
              cwd: getWorkspacePath(),
              timeout: 120_000,
              maxBuffer: 10 * 1024 * 1024,
            });
            const generatedFiles = await scanGeneratedFiles();
            return JSON.stringify({
              exitCode: 0,
              stdout,
              stderr,
              command,
              generatedFiles,
            });
          } catch (error: any) {
            const generatedFiles = await scanGeneratedFiles();
            return JSON.stringify({
              exitCode: error.code ?? 1,
              stdout: error.stdout ?? "",
              stderr: error.stderr ?? error.message ?? "Unknown",
              command,
              generatedFiles,
            });
          }
        },
      ),
    }),

    web_search: tool({
      description: "Searches the web using DuckDuckGo.",
      inputSchema: z.object({
        label: z.string().optional(),
        query: z.string(),
      }),
      execute: wrap(
        "web_search",
        async ({ query }: { query: string }) => {
          const ddgs = new DDGS({ timeout: 8000 });
          const raw = await ddgs.text({ keywords: query, maxResults: 6 });
          const results = raw
            .map(
              (r: {
                title: string;
                href: string;
                body: string;
              }) => ({
                title: r.title,
                url:
                  r.href && !r.href.startsWith("/") ? r.href : "",
                snippet: r.body
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 300),
              }),
            )
            .filter((r: { url: string }) => r.url);
          return JSON.stringify({
            query,
            results,
            totalResults: results.length,
          });
        },
      ),
    }),

    web_fetch: tool({
      description:
        "Fetches a URL and returns its text content. Optionally pass a CSS selector.",
      inputSchema: z
        .object({
          label: z.string().optional(),
          url: z.string(),
          selector: z.string().optional(),
        })
        .refine(
          ({ url }) => {
            try {
              new URL(url);
              return true;
            } catch {
              return false;
            }
          },
          { message: "Invalid URL" },
        ),
      execute: wrap(
        "web_fetch",
        async ({
          url,
          selector,
        }: {
          url: string;
          selector?: string;
        }) => {
          let targetUrl = url.trim();
          try {
            const parsed = new URL(targetUrl);
            if (!["http:", "https:"].includes(parsed.protocol)) {
              return JSON.stringify({
                url: targetUrl,
                error: `Unsupported protocol "${parsed.protocol}"`,
                status: 400,
              });
            }
          } catch {
            targetUrl = `https://${targetUrl.replace(/^https?:\/+/, "")}`;
          }
          const response = await fetch(targetUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
            },
            signal: AbortSignal.timeout(30_000),
          });
          const raw = await response.text();
          const ct = response.headers.get("content-type") || "";
          const isText =
            ct.includes("text") ||
            ct.includes("json") ||
            ct.includes("xml") ||
            ct.includes("html");
          let content = `[Binary: ${ct}]`;
          let truncated = false;
          if (isText) {
            if (selector) {
              const dom = new JSDOM(raw);
              const elements =
                dom.window.document.querySelectorAll(selector);
              content = Array.from(elements)
                .map(
                  (el: Element) =>
                    el.textContent?.trim?.() || "",
                )
                .filter(Boolean)
                .join("\n\n");
              if (!content)
                content = `[No elements matched selector "${selector}"]`;
            } else {
              const articleMatch =
                raw.match(
                  /<article[\s\S]*?<\/article>/i,
                ) ||
                raw.match(/<main[\s\S]*?<\/main>/i) ||
                raw.match(
                  /id="mw-content-text"[\s\S]*?(?=<div class="printfooter"|$)/i,
                ) ||
                raw.match(
                  /id="bodyContent"[\s\S]*?(?=<div class="visualClear"|$)/i,
                );
              const target = articleMatch
                ? articleMatch[0]
                : raw;
              content = target
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<nav[\s\S]*?<\/nav>/gi, "")
                .replace(/<header[\s\S]*?<\/header>/gi, "")
                .replace(/<footer[\s\S]*?<\/footer>/gi, "")
                .replace(/<[^>]+>/g, "")
                .replace(/\s+/g, " ")
                .trim();
              if (content.length > 20_000) {
                content =
                  content.slice(0, 20_000) +
                  "\n\n[...truncated...]";
                truncated = true;
              }
            }
          }
          return JSON.stringify({
            url: targetUrl,
            status: response.status,
            contentType: ct,
            content,
            truncated,
            size: raw.length,
            selectorUsed: selector,
          });
        },
      ),
    }),

    read_memory: tool({
      description: "Reads persistent memory across sessions.",
      inputSchema: z.object({ label: z.string().optional() }),
      execute: async () =>
        JSON.stringify({ entries: await getMemoryEntries() }),
    }),
  };

  if (task.permissions.browserAccess) {
    const { createBrowserTools: createBrowserToolsFn } = await import("@/lib/agent/browser/browser-tools");
    const browserTools = createBrowserToolsFn(threadId);
    for (const [key, bt] of Object.entries(browserTools)) {
      baseTools[key] = bt;
    }
  }

  try {
    const result = streamText({
      model: zen.chat(resolveZenModel()),
      system: buildTaskSystemPrompt(task),
      prompt: `Execute task: ${task.name}`,
      maxRetries: 0,
      temperature: 0.3,
      tools: baseTools,
      stopWhen: async ({ steps }: { steps: any[] }) => steps.length >= 5,
    });

    const output = await result.text;
    const steps = await result.steps;
    const toolCount = steps.reduce((sum: number, s: any) => sum + (s.toolCalls?.length ?? 0), 0);
    const duration = Date.now() - startTime;

    console.log(`[task-executor] Task ${task.id} completed: tools=${toolCount}, steps=${steps.length}, output=${(output || "(no output)").slice(0, 100)}`);

    await appendLog({
      timestamp: startTime,
      taskId: task.id,
      name: task.name,
      status: "success",
      output: `[tools used: ${toolCount}] ${(output || "(no output)").slice(0, 480)}`,
      duration,
    });

    return { status: "success" as const, output: output || "(no output)", duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errMsg =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    console.error(`[task-executor] Task ${task.id} failed: ${errMsg}`);

    await appendLog({
      timestamp: startTime,
      taskId: task.id,
      name: task.name,
      status: "error",
      output: errMsg.slice(0, 500),
      duration,
    });

    return { status: "error" as const, output: errMsg, duration };
  }
}
