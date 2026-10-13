import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { readFile, writeFile, unlink, readdir, stat, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  getWorkspacePath,
  resolvePathInWorkspace,
  relativePathInWorkspace,
} from "@/lib/middleware/workspace";
import { allowedDirsStore, toAbsoluteDir } from "@/lib/permissions/allowed-dirs";

function resolveAgentPath(targetPath: string, access: "read" | "write"): string {
  try {
    return resolvePathInWorkspace(targetPath);
  } catch (e) {
    const abs = toAbsoluteDir(targetPath, getWorkspacePath());
    if (abs && allowedDirsStore.isAllowed(abs, access)) return abs;
    throw e;
  }
}

function displayAgentPath(absolutePath: string): string {
  try {
    return relativePathInWorkspace(absolutePath);
  } catch {
    return absolutePath;
  }
}

function formatError(e: unknown, path: string): string {
  const err = e as NodeJS.ErrnoException;
  const code = err.code || "UNKNOWN";
  return `${err.message || String(e)} (${code}) for ${path}`;
}

function textOut(payload: unknown): { output: Array<{ type: "text"; text: string }> } {
  return { output: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

export const readFileTool = defineTool({
  name: "read_file",
  description: "Read a file at a workspace-relative path (absolute paths work too when inside a user-approved Allowed directory). Returns content and metadata.",
  parameters: Type.Object({ path: Type.String({ description: "Workspace-relative path" }) }),
  replay: "safe",
  execute: async (args) => {
    try {
      const resolved = resolveAgentPath(args.path, "read");
      const content = await readFile(resolved, "utf-8");
      const s = await stat(resolved);
      return textOut({
        path: resolved, relativePath: displayAgentPath(resolved),
        size: s.size, lineCount: content.split("\n").length, content,
      });
    } catch (e: unknown) {
      return textOut({ error: formatError(e, args.path), code: (e as NodeJS.ErrnoException).code });
    }
  },
});

export const writeFileTool = defineTool({
  name: "write_file",
  description: "Create or overwrite a file. Auto-creates parent dirs. Use documents/, presentations/, spreadsheets/, images/, code/ for outputs. (Never auto-replayed after a crash.)",
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  execute: async (args) => {
    try {
      const resolved = resolveAgentPath(args.path, "write");
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, args.content, "utf-8");
      const s = await stat(resolved);
      return textOut({ path: resolved, relativePath: displayAgentPath(resolved), size: s.size, status: "written" });
    } catch (e: unknown) {
      return textOut({ error: formatError(e, args.path), code: (e as NodeJS.ErrnoException).code });
    }
  },
});

export const editFileTool = defineTool({
  name: "edit_file",
  description: "Find exact text in a file and replace it. Read file first to get exact string. (Never auto-replayed after a crash.)",
  parameters: Type.Object({
    path: Type.String(),
    oldString: Type.String(),
    newString: Type.String(),
  }),
  execute: async (args) => {
    try {
      const resolved = resolveAgentPath(args.path, "write");
      const content = await readFile(resolved, "utf-8");
      if (!content.includes(args.oldString)) {
        return textOut({ error: "Text not found", hint: "Read file first for exact match" });
      }
      if (content.indexOf(args.oldString) !== content.lastIndexOf(args.oldString)) {
        return textOut({ error: "Multiple matches — provide more context" });
      }
      await writeFile(resolved, content.replace(args.oldString, args.newString), "utf-8");
      return textOut({ path: resolved, status: "edited" });
    } catch (e: unknown) {
      return textOut({ error: formatError(e, args.path), code: (e as NodeJS.ErrnoException).code });
    }
  },
});

export const deleteFileTool = defineTool({
  name: "delete_file",
  description: "Delete a file at workspace-relative path. Destructive: the guard hook requires a memoized approval before this runs. (Never auto-replayed after a crash.)",
  parameters: Type.Object({ path: Type.String() }),
  execute: async (args) => {
    try {
      const resolved = resolveAgentPath(args.path, "write");
      await unlink(resolved);
      return textOut({ path: resolved, status: "deleted" });
    } catch (e: unknown) {
      return textOut({ error: formatError(e, args.path), code: (e as NodeJS.ErrnoException).code });
    }
  },
});

export const listDirectoryTool = defineTool({
  name: "list_directory",
  description: "List files and directories at a workspace-relative path (absolute paths work too when inside a user-approved Allowed directory).",
  parameters: Type.Object({ path: Type.String({ description: "Workspace-relative path, e.g. '.' , 'documents'" }) }),
  replay: "safe",
  execute: async (args) => {
    try {
      const resolved = resolveAgentPath(args.path, "read");
      const entries = await readdir(resolved, { withFileTypes: true });
      const items: Array<{ name: string; type: string; size: number }> = [];
      for (const e of entries.slice(0, 500)) {
        let size = 0;
        try {
          if (e.isFile()) size = (await stat(join(resolved, e.name))).size;
        } catch {}
        items.push({ name: e.name, type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other", size });
      }
      return textOut({ path: resolved, items });
    } catch (e: unknown) {
      return textOut({ error: formatError(e, args.path), code: (e as NodeJS.ErrnoException).code });
    }
  },
});

export const presentFileTool = defineTool({
  name: "present_file",
  description: "Surface a workspace file in chat as a file card. Call ONCE per FINAL deliverable. Returns card JSON the UI renders; never present intermediate builder scripts.",
  parameters: Type.Object({ path: Type.String({ description: "Workspace-relative path of an existing file" }) }),
  replay: "safe",
  execute: async (args) => {
    try {
      const resolved = resolveAgentPath(args.path, "read");
      const s = await stat(resolved);
      if (!s.isFile()) return textOut({ error: `Not a file: ${args.path}` });
      return textOut({
        path: resolved,
        relativePath: displayAgentPath(resolved),
        filename: displayAgentPath(resolved).split("/").pop() || args.path,
        size: s.size,
        status: "presented",
      });
    } catch (e: unknown) {
      return textOut({ error: formatError(e, args.path), code: (e as NodeJS.ErrnoException).code });
    }
  },
});

export function buildFilesExtension() {
  return defineExtension({
    name: "workspace",
    tools: [readFileTool, writeFileTool, editFileTool, deleteFileTool, listDirectoryTool, presentFileTool],
  });
}
