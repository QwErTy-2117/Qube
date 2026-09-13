/**
 * ACP-scoped tools for Qube.
 *
 * File/command tools operate relative to the ACP session `cwd`
 * (not the global WORKSPACE_PATH), so editors can point Qube at any
 * directory. Destructive operations request approval via the ACP client
 * (`session/request_permission`); workspace-local reads proceed directly.
 * If the client has no permission UI (or the request fails), we fall back
 * to allow-within-session-roots / deny-outside.
 */

import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile, unlink, readdir, stat, mkdir } from "node:fs/promises";
import { resolve, relative, sep, isAbsolute, dirname, join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AcpSession } from "./sessions";

const execAsync = promisify(exec);

export type AcpClientLike = {
  requestPermission?: (
    toolCall: Record<string, unknown>,
    options?: Array<Record<string, unknown>>
  ) => Promise<{ approved: boolean }>;
};

function isOutside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (!rel) return false;
  return rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel);
}

function resolveInSession(session: AcpSession, targetPath: string): string {
  const roots = [session.cwd, ...(session.additionalDirectories || [])];
  // Absolute path: allow if inside any session root.
  if (isAbsolute(targetPath)) {
    const resolved = resolve(targetPath);
    for (const r of roots) {
      if (!isOutside(resolve(r), resolved)) return resolved;
    }
    // Fall back to global workspace / allowed dirs (shared with chat harness).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolvePathInWorkspace } = require("@/lib/middleware/workspace") as typeof import("@/lib/middleware/workspace");
      return resolvePathInWorkspace(targetPath);
    } catch {}
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { allowedDirsStore, toAbsoluteDir } = require("@/lib/permissions/allowed-dirs") as typeof import("@/lib/permissions/allowed-dirs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getWorkspacePath } = require("@/lib/middleware/workspace") as typeof import("@/lib/middleware/workspace");
      const abs = toAbsoluteDir(targetPath, getWorkspacePath());
      if (abs && allowedDirsStore.isAllowed(abs, "read")) return abs;
    } catch {}
    throw new Error(`Path ${targetPath} is outside the session directories`);
  }
  // Relative path: resolve against session cwd first.
  const inCwd = resolve(session.cwd, targetPath);
  if (!isOutside(resolve(session.cwd), inCwd)) return inCwd;
  for (const r of session.additionalDirectories || []) {
    const cand = resolve(r, targetPath);
    if (!isOutside(resolve(r), cand)) return cand;
  }
  return inCwd;
}

function displayPath(session: AcpSession, abs: string): string {
  try {
    const rel = relative(session.cwd, abs);
    if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  } catch {}
  return abs;
}

async function requestAcpApproval(
  client: AcpClientLike | undefined,
  sessionId: string,
  toolCallId: string,
  title: string,
  kind: string,
  rawInput: Record<string, unknown>
): Promise<boolean> {
  if (!client?.requestPermission) return true;
  try {
    const res = await client.requestPermission(
      { toolCallId, title, kind, status: "pending", rawInput },
      [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ]
    );
    return res.approved;
  } catch {
    // Client without permission support — allow; session-root scoping is the guard.
    return true;
  }
}

export type AcpToolsOptions = {
  readOnly?: boolean;
  client?: AcpClientLike;
  sessionId?: string;
};

export function createAcpTools(session: AcpSession, opts?: AcpToolsOptions) {
  const client = opts?.client;
  const sessionId = opts?.sessionId || session.sessionId;
  const readOnly = opts?.readOnly === true;

  const guardWrite = async (title: string, kind: string, rawInput: Record<string, unknown>) => {
    if (readOnly) return { denied: `Session is in ask (read-only) mode; ${title} refused.` };
    const ok = await requestAcpApproval(
      client,
      sessionId,
      `acp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      kind,
      rawInput
    );
    if (!ok) return { denied: "Denied by user (ACP permission request)." };
    return null;
  };

  return {
    read_file: tool({
      description: "Read a file relative to the session working directory (absolute paths inside session roots also work).",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        try {
          const resolved = resolveInSession(session, path);
          const content = await readFile(resolved, "utf-8");
          const s = await stat(resolved);
          return JSON.stringify({
            path: resolved,
            relativePath: displayPath(session, resolved),
            size: s.size,
            lineCount: content.split("\n").length,
            content: content.slice(0, 100000),
          });
        } catch (e: any) {
          return JSON.stringify({ error: e?.message || String(e), code: (e as any)?.code });
        }
      },
    }),

    write_file: tool({
      description: "Create or overwrite a file relative to the session working directory. Auto-creates parent dirs.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        const denied = await guardWrite(`write ${path}`, "edit", { path });
        if (denied) return JSON.stringify({ error: denied.denied });
        try {
          const resolved = resolveInSession(session, path);
          await mkdir(dirname(resolved), { recursive: true });
          await writeFile(resolved, content, "utf-8");
          const s = await stat(resolved);
          return JSON.stringify({ path: resolved, relativePath: displayPath(session, resolved), size: s.size, status: "written" });
        } catch (e: any) {
          return JSON.stringify({ error: e?.message || String(e) });
        }
      },
    }),

    edit_file: tool({
      description: "Find exact text in a file and replace it. Read the file first.",
      inputSchema: z.object({ path: z.string(), oldString: z.string(), newString: z.string() }),
      execute: async ({ path, oldString, newString }: { path: string; oldString: string; newString: string }) => {
        const denied = await guardWrite(`edit ${path}`, "edit", { path });
        if (denied) return JSON.stringify({ error: denied.denied });
        try {
          const resolved = resolveInSession(session, path);
          const content = await readFile(resolved, "utf-8");
          if (!content.includes(oldString)) return JSON.stringify({ error: "Text not found", hint: "Read file first for exact match" });
          if (content.indexOf(oldString) !== content.lastIndexOf(oldString))
            return JSON.stringify({ error: "Multiple matches — provide more context" });
          await writeFile(resolved, content.replace(oldString, newString), "utf-8");
          return JSON.stringify({ path: resolved, status: "edited" });
        } catch (e: any) {
          return JSON.stringify({ error: e?.message || String(e) });
        }
      },
    }),

    delete_file: tool({
      description: "Delete a file relative to the session working directory.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        const denied = await guardWrite(`delete ${path}`, "delete", { path });
        if (denied) return JSON.stringify({ error: denied.denied });
        try {
          const resolved = resolveInSession(session, path);
          await unlink(resolved);
          return JSON.stringify({ path: resolved, status: "deleted" });
        } catch (e: any) {
          return JSON.stringify({ error: e?.message || String(e) });
        }
      },
    }),

    list_directory: tool({
      description: "List files at a session-relative path ('.' for session root).",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        try {
          const resolved = resolveInSession(session, path);
          const entries = await readdir(resolved, { withFileTypes: true });
          const items = await Promise.all(
            entries.slice(0, 500).map(async (e) => {
              const full = join(resolved, e.name);
              let size = 0;
              try {
                size = (await stat(full)).size;
              } catch {}
              return { name: e.name, type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other", size, path: full };
            })
          );
          return JSON.stringify({ path: resolved, items, totalItems: entries.length, truncated: entries.length > 500 });
        } catch (e: any) {
          return JSON.stringify({ error: e?.message || String(e) });
        }
      },
    }),

    run_command: tool({
      description: "Run a shell command with cwd = session working directory. 120s timeout.",
      inputSchema: z.object({ command: z.string(), timeoutMs: z.number().optional() }),
      execute: async ({ command, timeoutMs }: { command: string; timeoutMs?: number }) => {
        const denied = await guardWrite(`run: ${command.slice(0, 120)}`, "execute", { command });
        if (denied) return JSON.stringify({ error: denied.denied });
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: session.cwd,
            timeout: timeoutMs ?? 120000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
          });
          return JSON.stringify({ command, cwd: session.cwd, stdout: stdout.slice(0, 20000), stderr: stderr.slice(0, 20000), exitCode: 0 });
        } catch (e: any) {
          return JSON.stringify({
            command,
            cwd: session.cwd,
            stdout: (e.stdout?.toString() || "").slice(0, 20000),
            stderr: (e.stderr?.toString() || e.message || String(e)).slice(0, 20000),
            exitCode: typeof e.code === "number" ? e.code : 1,
          });
        }
      },
    }),

    TodoWrite: tool({
      description: "Track session todos. Pass the COMPLETE list each call; exactly one in_progress.",
      inputSchema: z.object({
        todos: z.array(z.object({ content: z.string(), status: z.enum(["pending", "in_progress", "completed"]), activeForm: z.string() })),
      }),
      execute: async ({ todos }: { todos: Array<{ content: string; status: string; activeForm: string }> }) => {
        if (readOnly) return "Error: read-only mode.";
        const done = todos.filter((t) => t.status === "completed").length;
        return `Todos updated (${done}/${todos.length} completed).`;
      },
    }),
  };
}
