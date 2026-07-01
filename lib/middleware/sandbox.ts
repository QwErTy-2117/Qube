import { resolve, relative } from "node:path";

const SANDBOX_PATH = resolve(
  process.env.SANDBOX_PATH || process.cwd(),
  "playground"
);

export function getSandboxPath(): string {
  return SANDBOX_PATH;
}

export function isPathInSandbox(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  const rel = relative(SANDBOX_PATH, resolved);
  return !rel.startsWith("..");
}

export function resolvePathInSandbox(targetPath: string): string {
  const resolved = resolve(SANDBOX_PATH, targetPath);
  const rel = relative(SANDBOX_PATH, resolved);
  if (rel.startsWith("..")) {
    throw new Error(`Path ${targetPath} is outside the sandbox`);
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
