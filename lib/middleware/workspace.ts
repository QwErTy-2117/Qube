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
  // Pipe downloaded content straight into an interpreter (supply-chain risk).
  /(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh|python\d?|node|perl|ruby)\b/i,
  // Classic fork bomb.
  /:\s*\(\s*\)\s*\{.*:\s*\|\s*:.*&.*\}\s*;?\s*:/,
];

/** Shell separators that start a new command segment. */
const SHELL_SEGMENT_RE = /&&|\|\||[;|\n]/;

/** Per-segment patterns; applied after wrappers/env assignments are stripped. */
const DESTRUCTIVE_SEGMENT_PATTERNS: RegExp[] = [
  /^(?:sudo|doas)\b/i,
  /^(?:shutdown|reboot|halt|poweroff)\b/i,
  /^(?:mkfs(?:\.\w+)?|fdisk|parted|wipefs)\b/i,
  /^dd\b.*\bof=\/dev\//i,
  /^chmod\s+(?:-[A-Za-z]+\s+)*777\b/,
  /^(?:del\s+\/[sq]|rmdir\s+\/s|format\s+[a-z]:)/i,
  /^powershell\b.*-EncodedCommand/i,
];

/**
 * Strip shell wrappers and absolute binary prefixes from one command segment
 * so `cd x && sudo rm -rf /` and `/bin/rm -rf /` classify like `rm -rf /`.
 */
function normalizeCommandSegment(segment: string): string {
  let s = segment.trim().replace(/^[({]\s*/, "");
  for (let i = 0; i < 6; i++) {
    const before = s;
    // Leading env assignments: FOO=1 BAR=2 command ...
    s = s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s;|&]+)\s+)+/, "");
    // Wrappers. sudo is deliberately NOT stripped: privilege escalation is
    // itself destructive and must remain visible to the pattern below.
    s = s.replace(/^(?:command|builtin|exec|nohup|time|nice|stdbuf|timeout\s+\S+)\s+/, "");
    s = s.replace(/^\/(?:usr\/)?(?:local\/)?s?bin\//, "");
    if (s === before) break;
  }
  return s.trim();
}

/** True for recursive+force deletes or any recursive delete of a root. */
function isDangerousRm(segment: string): boolean {
  if (!/^rm\b/i.test(segment)) return false;
  const words = segment.split(/\s+/).slice(1);
  let recursive = false;
  let force = false;
  const targets: string[] = [];
  for (const word of words) {
    if (!word || word === "--") continue;
    if (word.startsWith("-")) {
      if (/^--recursive$/i.test(word) || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(word)) recursive = true;
      if (/^--force$/i.test(word) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(word)) force = true;
    } else {
      targets.push(word);
    }
  }
  if (recursive && force) return true;
  return recursive && targets.some((t) => /^(?:\/|\/\*|~|~\/\*)$/.test(t));
}

/**
 * Deterministic destructive-command classification. Chained commands are
 * checked segment by segment, so wrapping a destructive call in `cd … &&`
 * or `FOO=1` no longer hides it. False positives here cause an approval
 * prompt (or a default deny when destructive actions are disabled), never
 * silent execution.
 */
export function isDestructiveCommand(command: string): boolean {
  const raw = String(command || "").trim();
  if (!raw) return false;
  if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(raw))) return true;
  for (const segment of raw.split(SHELL_SEGMENT_RE)) {
    const normalized = normalizeCommandSegment(segment);
    if (!normalized) continue;
    if (isDangerousRm(normalized)) return true;
    if (DESTRUCTIVE_SEGMENT_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  }
  return false;
}

/**
 * Paths where a direct write can persist code execution or expose
 * credentials. These are never silently writable through file tools: the
 * classifier marks them destructive, so the hard policy (destructive actions
 * off by default) denies them unless the user explicitly enabled destructive
 * actions. Reads are unaffected; `git` commands are the supported way to
 * change repository metadata.
 */
const PROTECTED_PATH_RULES: Array<{ re: RegExp; label: string }> = [
  {
    re: /(^|\/)\.git\/(?:hooks|config|objects|refs|logs|HEAD|index|packed-refs|modules)(?:\/|$)/i,
    label: "Git internals",
  },
  { re: /(^|\/)\.ssh(?:\/|$)/i, label: "SSH keys" },
  { re: /(^|\/)\.gnupg(?:\/|$)/i, label: "GPG keys" },
  { re: /(^|\/)\.aws(?:\/|$)/i, label: "AWS credentials" },
  { re: /(^|\/)\.kube\/config$/i, label: "Kubernetes credentials" },
  { re: /(^|\/)\.docker\/config\.json$/i, label: "Docker credentials" },
  { re: /(^|\/)\.netrc$/i, label: "netrc credentials" },
  { re: /(^|\/)\.config\/gh\/hosts\.yml$/i, label: "GitHub CLI credentials" },
  {
    re: /^([a-z]:)?\/(?:etc|usr|bin|sbin|boot|dev|proc|sys|windows|program files)(?:\/|$)/i,
    label: "system directory",
  },
];

export function classifyProtectedPath(targetPath: string): { protected: boolean; reason?: string } {
  const p = String(targetPath || "").replace(/\\/g, "/");
  if (!p) return { protected: false };
  for (const rule of PROTECTED_PATH_RULES) {
    if (rule.re.test(p)) return { protected: true, reason: rule.label };
  }
  return { protected: false };
}
