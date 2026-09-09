import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, dirname, normalize, sep, isAbsolute } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { expandHome } from "@/lib/middleware/workspace";

export type DirAccess = "read" | "write";

export interface AllowedDir {
  id: string;
  /** Absolute, normalized path (no trailing separator). */
  path: string;
  access: DirAccess;
  addedAt: number;
  source: "chat" | "settings";
}

function dirsFilePath(): string {
  return join(getDataDir(), ".memory", "allowed-directories.json");
}

function normalizeDir(p: string): string {
  let n = normalize(p);
  if (n.length > 1 && n.endsWith(sep)) n = n.slice(0, -1);
  return n;
}

function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

export function toAbsoluteDir(input: string, workspacePath?: string): string | null {
  const t = (input || "").trim();
  if (!t) return null;
  const expanded = expandHome(t);
  if (isAbsolute(expanded) || isWindowsPath(expanded)) return normalizeDir(resolve(expanded));
  // Workspace-relative: resolve against workspace when known, else cwd
  const base = workspacePath || process.cwd();
  return normalizeDir(resolve(base, expanded));
}

/**
 * Scope an approval to a directory: if the path is an existing directory
 * use it, otherwise use its parent directory.
 */
export function scopeDirForPath(input: string, workspacePath?: string): string | null {
  const abs = toAbsoluteDir(input, workspacePath);
  if (!abs) return null;
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return abs;
  } catch {}
  return normalizeDir(dirname(abs));
}

class AllowedDirsStore {
  private dirs: AllowedDir[] = [];
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const file = dirsFilePath();
      if (existsSync(file)) {
        const raw = readFileSync(file, "utf-8");
        const data = JSON.parse(raw);
        const arr: AllowedDir[] = Array.isArray(data?.dirs)
          ? data.dirs
          : Array.isArray(data)
            ? data
            : [];
        for (const d of arr) {
          if (!d || typeof d.path !== "string") continue;
          this.dirs.push({
            id: typeof d.id === "string" ? d.id : `dir_${Date.now().toString(36)}`,
            path: normalizeDir(d.path),
            access: d.access === "write" ? "write" : "read",
            addedAt: typeof d.addedAt === "number" ? d.addedAt : Date.now(),
            source: d.source === "chat" ? "chat" : "settings",
          });
        }
      }
    } catch (e) {
      console.error("[AllowedDirs] Failed to load:", e);
    }
  }

  private persist() {
    try {
      const file = dirsFilePath();
      const dir = join(getDataDir(), ".memory");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify({ dirs: this.dirs }, null, 2), "utf-8");
    } catch (e) {
      console.error("[AllowedDirs] Failed to write:", e);
    }
  }

  getAll(): AllowedDir[] {
    this.ensureInitialized();
    return this.dirs.map((d) => ({ ...d }));
  }

  /** write covers read. Matches the dir itself and everything under it. */
  isAllowed(absPath: string, required: DirAccess): boolean {
    this.ensureInitialized();
    const n = normalizeDir(absPath);
    for (const d of this.dirs) {
      if (n === d.path || n.startsWith(d.path + sep)) {
        if (d.access === "write") return true;
        if (required === "read") return true;
      }
    }
    return false;
  }

  add(path: string, access: DirAccess, source: "chat" | "settings"): AllowedDir {
    this.ensureInitialized();
    const n = normalizeDir(path);
    const existing = this.dirs.find((d) => d.path === n);
    if (existing) {
      // Escalate read->write, keep earliest addedAt
      if (existing.access === "read" && access === "write") existing.access = "write";
      this.persist();
      return { ...existing };
    }
    const entry: AllowedDir = {
      id: `dir_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      path: n,
      access,
      addedAt: Date.now(),
      source,
    };
    this.dirs.push(entry);
    this.persist();
    return { ...entry };
  }

  setAccess(id: string, access: DirAccess): AllowedDir | null {
    this.ensureInitialized();
    const d = this.dirs.find((x) => x.id === id);
    if (!d) return null;
    d.access = access;
    this.persist();
    return { ...d };
  }

  remove(id: string): boolean {
    this.ensureInitialized();
    const before = this.dirs.length;
    this.dirs = this.dirs.filter((d) => d.id !== id);
    if (this.dirs.length === before) return false;
    this.persist();
    return true;
  }

  /** Wholesale replace from Preferences UI (validated absolute dirs). */
  sync(dirs: AllowedDir[]): { ok: boolean; error?: string } {
    this.ensureInitialized();
    for (const d of dirs) {
      const raw = (d.path || "").trim();
      if (!raw) return { ok: false, error: "Directory path is required." };
      if (!isAbsolute(raw) && !raw.startsWith("~") && !isWindowsPath(raw)) {
        return { ok: false, error: `"${d.path}" must be an absolute path or start with ~/.` };
      }
    }
    const now = Date.now();
    this.dirs = dirs.map((d) => ({
      id: d.id || `dir_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      path: normalizeDir(toAbsoluteDir(d.path)!),
      access: d.access === "write" ? "write" : "read",
      addedAt: d.addedAt || now,
      source: d.source === "chat" ? "chat" : "settings",
    }));
    this.persist();
    return { ok: true };
  }
}

export const allowedDirsStore = new AllowedDirsStore();
