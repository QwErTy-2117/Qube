/**
 * Qube Computer filesystem rules: everything is confined to the runtime.
 *
 * The computer is process-isolated by convention plus guards: every path a
 * tool supplies is resolved against the runtime root, absolute paths and
 * `..` segments are rejected, and symlinks are resolved before the check so
 * a planted link cannot walk out of the sandbox. Files that genuinely live
 * on the host only move in/out through `stageAttachment` / `exportToHost`,
 * which the tool layer wraps in the normal permission prompt.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile, open } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { getComputerPaths, type ComputerPaths } from "./paths";
import { ensureComputerDirs } from "./session";

export const MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;
export const MAX_READ_BYTES = 2 * 1024 * 1024;
export const MAX_WRITE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_READ_BYTES = 256 * 1024;
const LIST_LIMIT = 500;

export class ComputerPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputerPathError";
  }
}

/** True when `target` is `root` itself or lives below it. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Resolve a tool-supplied relative path inside the runtime. Absolute paths
 * are refused outright (the computer's own paths are all relative to its
 * root) and symlinked parents are resolved before the containment check.
 */
export async function resolveRuntimePath(input: string, options: { root?: string } = {}): Promise<string> {
  const paths = getComputerPaths();
  ensureComputerDirs(paths);
  const root = resolve(options.root ?? paths.home);
  const raw = (input ?? "").trim();
  const candidate = raw === "" || raw === "." ? root : raw;
  if (isAbsolute(candidate) || /^[a-zA-Z]:[\\/]/.test(candidate)) {
    throw new ComputerPathError("Paths are relative to the computer root; absolute paths are not accepted.");
  }
  const absolute = resolve(root, candidate);
  if (!isInside(root, absolute)) {
    throw new ComputerPathError(`Path escapes the computer: ${raw}`);
  }
  // Resolve the deepest existing ancestor so a symlink cannot be used to
  // step outside the sandbox.
  let probe = absolute;
  while (true) {
    try {
      const real = await realpath(probe);
      const realRoot = await realpath(root).catch(() => root);
      if (!isInside(realRoot, real)) throw new ComputerPathError(`Path escapes the computer: ${raw}`);
      break;
    } catch (error) {
      if (error instanceof ComputerPathError) throw error;
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return absolute;
}

export type ComputerEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  modifiedAt: string;
};

export async function listComputerDir(input = ".", opts: { depth?: number; limit?: number } = {}): Promise<ComputerEntry[]> {
  const paths = getComputerPaths();
  const root = await resolveRuntimePath(input);
  const depth = Math.max(0, Math.min(opts.depth ?? 1, 3));
  const limit = Math.max(1, Math.min(opts.limit ?? LIST_LIMIT, LIST_LIMIT));
  const out: ComputerEntry[] = [];
  const walk = async (dir: string, level: number) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = join(dir, entry.name);
      const relPath = relative(paths.home, full).split(sep).join("/") || ".";
      if (entry.isDirectory()) {
        out.push({ name: entry.name, path: relPath, type: "dir", size: 0, modifiedAt: "" });
        if (level < depth) await walk(full, level + 1);
      } else if (entry.isFile()) {
        let size = 0;
        let modifiedAt = "";
        try {
          const st = await stat(full);
          size = st.size;
          modifiedAt = st.mtime.toISOString();
        } catch {}
        out.push({ name: entry.name, path: relPath, type: "file", size, modifiedAt });
      }
    }
  };
  await walk(root, 0);
  return out;
}

export type ComputerFileRead = {
  path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  content: string;
};

export async function readComputerFile(input: string, opts: { maxBytes?: number } = {}): Promise<ComputerFileRead> {
  const absolute = await resolveRuntimePath(input);
  const info = await stat(absolute).catch(() => null);
  if (!info || !info.isFile()) throw new ComputerPathError(`Not a file: ${input}`);
  const maxBytes = Math.max(1, Math.min(opts.maxBytes ?? DEFAULT_READ_BYTES, MAX_READ_BYTES));
  const handle = await open(absolute, "r");
  try {
    const head = Buffer.alloc(Math.min(info.size, Math.max(8192, Math.min(maxBytes, info.size))));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const slice = head.subarray(0, bytesRead);
    const binary = slice.includes(0);
    const clipped = slice.subarray(0, Math.min(slice.length, maxBytes));
    return {
      path: relative(getComputerPaths().home, absolute).split(sep).join("/"),
      size: info.size,
      truncated: info.size > clipped.length,
      binary,
      content: binary ? "" : clipped.toString("utf-8"),
    };
  } finally {
    await handle.close();
  }
}

export async function writeComputerFile(input: string, content: string): Promise<{ path: string; bytes: number }> {
  const absolute = await resolveRuntimePath(input);
  const bytes = Buffer.byteLength(content ?? "", "utf-8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new ComputerPathError(`Refusing to write ${bytes} bytes (limit ${MAX_WRITE_BYTES}).`);
  }
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content ?? "", "utf-8");
  return { path: relative(getComputerPaths().home, absolute).split(sep).join("/"), bytes };
}

export async function deleteComputerPath(input: string): Promise<{ path: string; type: "file" | "dir" }> {
  const absolute = await resolveRuntimePath(input);
  if (absolute === resolve(getComputerPaths().home)) {
    throw new ComputerPathError("Refusing to delete the computer root.");
  }
  const info = await stat(absolute).catch(() => null);
  if (!info) throw new ComputerPathError(`Not found: ${input}`);
  await rm(absolute, { recursive: info.isDirectory(), force: false });
  return { path: input, type: info.isDirectory() ? "dir" : "file" };
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A display-safe, collision-free file name. Unicode is preserved (NFC) —
 * stripping non-ASCII would rename half the world's documents — while
 * separators, control characters and traversal shapes are neutralised.
 */
export function sanitizeFilename(name: string, fallback = "attachment"): string {
  const normalized = (name || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "");
  const base = basename(normalized.split(/[\\/]/).pop() || "").replace(/[:*?"<>|]/g, "_").trim();
  const cleaned = base.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (!cleaned) return fallback;
  const ext = extname(cleaned);
  const stem = ext ? cleaned.slice(0, -ext.length) : cleaned;
  const safeStem = (WINDOWS_RESERVED.test(stem) ? `_${stem}` : stem).slice(0, 120) || fallback;
  const safeExt = ext.slice(0, 20);
  return `${safeStem}${safeExt}`;
}

async function uniqueTarget(dir: string, filename: string): Promise<string> {
  const ext = extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  let candidate = join(dir, filename);
  let n = 2;
  while (true) {
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
    candidate = join(dir, `${stem} (${n})${ext}`);
    n += 1;
    if (n > 9999) throw new ComputerPathError("Too many files with the same name.");
  }
}

export type StagedAttachment = {
  name: string;
  /** Absolute path inside the computer — this is what tools receive. */
  path: string;
  relativePath: string;
  bytes: number;
  sha256: string;
};

async function finishStaged(paths: ComputerPaths, target: string, source: { stream?: () => NodeJS.ReadableStream }): Promise<StagedAttachment> {
  const info = await stat(target);
  const hash = createHash("sha256");
  await pipeline(createReadStream(target), hash);
  void source;
  return {
    name: basename(target),
    path: target,
    relativePath: relative(paths.root, target).split(sep).join("/"),
    bytes: info.size,
    sha256: hash.digest("hex").slice(0, 16),
  };
}

/** Stage an in-memory upload (chat attachment, generated file, …). */
export async function stageAttachmentBuffer(
  data: Buffer | Uint8Array,
  filename: string,
): Promise<StagedAttachment> {
  const paths = ensureComputerDirs(getComputerPaths());
  const bytes = Buffer.byteLength(data as Buffer);
  if (bytes > MAX_ATTACHMENT_BYTES) {
    throw new ComputerPathError(`Attachment is ${bytes} bytes (limit ${MAX_ATTACHMENT_BYTES}).`);
  }
  const safe = sanitizeFilename(filename);
  const target = await uniqueTarget(paths.attachments, safe);
  await writeFile(target, data);
  return finishStaged(paths, target, {});
}

/** Copy a host file into the computer (called only after permission check). */
export async function stageAttachmentFromHost(sourcePath: string, filename?: string): Promise<StagedAttachment> {
  const paths = ensureComputerDirs(getComputerPaths());
  const source = resolve(sourcePath.trim());
  const info = await stat(source).catch(() => null);
  if (!info) throw new ComputerPathError(`Host file not found: ${sourcePath}`);
  if (!info.isFile()) throw new ComputerPathError(`Not a regular file: ${sourcePath}`);
  if (info.size > MAX_ATTACHMENT_BYTES) {
    throw new ComputerPathError(`Host file is ${info.size} bytes (limit ${MAX_ATTACHMENT_BYTES}).`);
  }
  const safe = sanitizeFilename(filename || basename(source));
  const target = await uniqueTarget(paths.attachments, safe);
  // Stream through a size counter rather than trusting the stat from before.
  let copied = 0;
  const counter = new (await import("node:stream")).Transform({
    transform(chunk: Buffer, _enc, cb) {
      copied += chunk.length;
      if (copied > MAX_ATTACHMENT_BYTES) {
        cb(new ComputerPathError("Attachment exceeded the size limit while copying."));
        return;
      }
      cb(null, chunk);
    },
  });
  await pipeline(createReadStream(source), counter, createWriteStream(target));
  return finishStaged(paths, target, {});
}

/**
 * Copy a file out of the computer to a host path. The destination is
 * explicit and permission-gated by the caller; the source may not escape
 * the runtime.
 */
export async function exportToHost(runtimePath: string, hostDestination: string): Promise<{ destination: string; bytes: number }> {
  const source = await resolveRuntimePath(runtimePath);
  const info = await stat(source).catch(() => null);
  if (!info || !info.isFile()) throw new ComputerPathError(`Not a file: ${runtimePath}`);
  const destination = resolve(hostDestination.trim());
  if (!destination) throw new ComputerPathError("Destination path is required.");
  await mkdir(dirname(destination), { recursive: true }).catch(() => {});
  await copyFile(source, destination);
  return { destination, bytes: info.size };
}

/** Read the first bytes of a file for the panel's text preview. */
export async function previewComputerFile(input: string): Promise<string> {
  try {
    const file = await readComputerFile(input, { maxBytes: 4096 });
    return file.binary ? "" : file.content;
  } catch {
    return "";
  }
}
