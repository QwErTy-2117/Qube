import { resolve, relative } from "node:path";

const WORKSPACE_PATH = resolve(
  process.env.WORKSPACE_PATH || process.cwd(),
  "playground"
);

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
