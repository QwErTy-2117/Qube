import { resolve, relative, sep, isAbsolute, normalize } from "node:path";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

function resolveWorkspacePath(): string {
  if (process.env.WORKSPACE_PATH) {
    return resolve(process.env.WORKSPACE_PATH);
  }
  const cwd = process.cwd();
  const dirName = process.env.WORKSPACE_DIR_NAME || "workspace";
  const preferred = resolve(cwd, dirName);
  if (existsSync(preferred)) {
    return preferred;
  }
  const legacy = resolve(cwd, "playground");
  if (existsSync(legacy)) {
    return legacy;
  }
  return preferred;
}

const WORKSPACE_PATH = resolveWorkspacePath();

export function getWorkspacePath(): string {
  return WORKSPACE_PATH;
}

function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

function isPathOutsideWorkspace(targetResolved: string, workspace: string): boolean {
  const rel = relative(workspace, targetResolved);
  if (!rel) return false;
  if (process.platform === "win32") {
    const lowerRel = rel.toLowerCase();
    const lowerWs = workspace.toLowerCase();
    const lowerTarget = targetResolved.toLowerCase();
    if (isAbsolute(rel)) return true;
    if (lowerRel.startsWith(`..${sep}`) || lowerRel === "..") return true;
    if (!lowerTarget.startsWith(lowerWs) && !lowerTarget.startsWith(lowerWs.replace(/\//g, "\\"))) {
      const normWs = normalize(workspace).toLowerCase();
      const normTarget = normalize(targetResolved).toLowerCase();
      if (!normTarget.startsWith(normWs)) {
        if (/^[a-zA-Z]:[\\/]/.test(targetResolved) && /^[a-zA-Z]:[\\/]/.test(workspace)) {
          if (targetResolved[0].toLowerCase() !== workspace[0].toLowerCase()) return true;
        }
      }
    }
    return false;
  }
  return rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel);
}

export function isPathInWorkspace(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  return !isPathOutsideWorkspace(resolved, WORKSPACE_PATH);
}

export function resolvePathInWorkspace(targetPath: string): string {
  const resolved = resolve(WORKSPACE_PATH, targetPath);
  if (isPathOutsideWorkspace(resolved, WORKSPACE_PATH)) {
    throw new Error(`Path ${targetPath} is outside the workspace`);
  }
  return resolved;
}

export function relativePathInWorkspace(absolutePath: string): string {
  const resolved = resolve(absolutePath);
  if (isPathOutsideWorkspace(resolved, WORKSPACE_PATH)) {
    throw new Error(`Path ${absolutePath} is outside the workspace`);
  }
  const rel = relative(WORKSPACE_PATH, resolved);
  return rel.split(sep).join("/");
}

const HOME_DIR = homedir();
const TMP_DIR = tmpdir();

export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") return HOME_DIR + p.slice(1);
  if (p.startsWith("/~/")) return HOME_DIR + p.slice(2);
  if (p.startsWith("%USERPROFILE%") || p.startsWith("$HOME")) {
    return p.replace(/^%USERPROFILE%|^ \$HOME/, HOME_DIR);
  }
  return p;
}

export function isPathAllowedExternal(targetPath: string): boolean {
  const expanded = expandHome(targetPath);
  const resolved = resolve(expanded);
  const lowerResolved = resolved.toLowerCase();
  const lowerHome = HOME_DIR.toLowerCase();
  const lowerTmp = TMP_DIR.toLowerCase();

  if (process.platform === "win32") {
    const normResolved = normalize(resolved).toLowerCase();
    const normHome = normalize(HOME_DIR).toLowerCase();
    const normTmp = normalize(TMP_DIR).toLowerCase();
    if (normResolved.startsWith(normHome)) return true;
    if (normResolved.startsWith(normTmp)) return true;
    if (/^[a-zA-Z]:[\\/]/.test(resolved) || resolved.startsWith("\\\\")) return true;
    return true;
  }

  return lowerResolved.startsWith(lowerHome) || lowerResolved.startsWith(lowerTmp) || lowerResolved.startsWith("/tmp");
}

export function resolveExternalPath(targetPath: string): string {
  const expanded = expandHome(targetPath);
  const resolved = resolve(expanded);
  if (!isAbsolute(resolved) && !isWindowsPath(resolved)) {
    throw new Error(`Path "${targetPath}" must be absolute or under home`);
  }
  return resolved;
}

export function normalizeWindowsPath(p: string): string {
  if (process.platform !== "win32") return p;
  return normalize(p);
}

export const DESTRUCTIVE_PATTERNS = [
  /^rm\s+-rf/,
  /^sudo\s+/,
  /curl\s+.*\|\s*(?:bash|sh|zsh)/,
  />\s*\/etc/,
  />\s*\/dev\//,
  /chmod\s+777/,
  /dd\s+if=\/dev/,
  /mkfs\./,
  /fdisk/,
  /powershell\s+.*-EncodedCommand/i,
  /del\s+\/[s|q]/i,
  /rmdir\s+\/s/i,
  /format\s+[a-z]:/i,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command.trim()));
}
