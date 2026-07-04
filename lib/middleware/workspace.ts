import { resolve, relative, sep } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

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

export function isPathInWorkspace(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  const rel = relative(WORKSPACE_PATH, resolved);
  return !rel.startsWith("..");
}

export function resolvePathInWorkspace(targetPath: string): string {
  const resolved = resolve(WORKSPACE_PATH, targetPath);
  const rel = relative(WORKSPACE_PATH, resolved);
  if (rel.startsWith("..")) {
    throw new Error(`Path ${targetPath} is outside the workspace`);
  }
  return resolved;
}

export function relativePathInWorkspace(absolutePath: string): string {
  const rel = relative(WORKSPACE_PATH, resolve(absolutePath));
  if (rel.startsWith("..")) {
    throw new Error(`Path ${absolutePath} is outside the workspace`);
  }
  return rel.split(sep).join("/");
}

const HOME_DIR = homedir();

export function isPathAllowedExternal(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  return resolved.startsWith(HOME_DIR) || resolved.startsWith("/tmp");
}

export function resolveExternalPath(targetPath: string): string {
  const resolved = resolve(targetPath);
  if (!isPathAllowedExternal(resolved)) {
    throw new Error(`Path ${targetPath} is not in an allowed external directory`);
  }
  return resolved;
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
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command.trim()));
}
