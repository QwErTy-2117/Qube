/**
 * Qube Computer session: lifecycle, activity journal and explicit reset.
 *
 * Lifecycle rules:
 * - The runtime directory is created on first use and then persists.
 * - Nothing is deleted automatically — no idle wipe, no wipe on restart,
 *   no wipe on upgrade. Only `resetComputer()` removes state, and only when
 *   the user asked for it.
 * - Idle cost is zero: no daemon, no background process. Work happens when
 *   a tool call arrives and stops when the command exits.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { computerDirectories, getComputerPaths, type ComputerPaths } from "./paths";

export type ComputerSession = {
  version: 1;
  /** Rotates on reset so panel clients can tell sessions apart. */
  id: string;
  createdAt: string;
  lastActiveAt: string;
  resets: number;
};

export type ActivityKind = "session" | "exec" | "file" | "attachment" | "browser" | "reset";

export type ActivityEntry = {
  at: string;
  kind: ActivityKind;
  summary: string;
  detail?: string;
};

const ACTIVITY_LIMIT_BYTES = 512 * 1024;
const ACTIVITY_READ_LIMIT = 120;

function now(): string {
  return new Date().toISOString();
}

export function ensureComputerDirs(paths: ComputerPaths = getComputerPaths()): ComputerPaths {
  for (const dir of computerDirectories(paths)) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return paths;
}

function newSession(): ComputerSession {
  const at = now();
  return { version: 1, id: randomUUID(), createdAt: at, lastActiveAt: at, resets: 0 };
}

function readStateFile(paths: ComputerPaths): ComputerSession | null {
  try {
    const parsed = JSON.parse(readFileSync(paths.stateFile, "utf-8")) as Partial<ComputerSession>;
    if (!parsed || parsed.version !== 1 || typeof parsed.id !== "string" || !parsed.id) return null;
    return {
      version: 1,
      id: parsed.id,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : now(),
      lastActiveAt: typeof parsed.lastActiveAt === "string" ? parsed.lastActiveAt : now(),
      resets: Number.isSafeInteger(parsed.resets) ? Number(parsed.resets) : 0,
    };
  } catch {
    return null;
  }
}

function writeStateFile(paths: ComputerPaths, session: ComputerSession): void {
  const tmp = `${paths.stateFile}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`, "utf-8");
  renameSync(tmp, paths.stateFile);
}

/**
 * Create the runtime if needed and return its (persistent) session.
 * A read-only data dir must not crash every tool: state falls back to an
 * in-memory session and the caller still gets a usable result.
 */
export function ensureComputer(): { paths: ComputerPaths; session: ComputerSession } {
  const paths = getComputerPaths();
  ensureComputerDirs(paths);
  const existing = readStateFile(paths);
  if (existing) return { paths, session: existing };
  const session = newSession();
  try {
    writeStateFile(paths, session);
    appendActivity({ kind: "session", summary: "Qube Computer session created" }, paths);
  } catch (error) {
    console.warn("[computer] could not persist session state:", (error as Error)?.message || error);
  }
  return { paths, session };
}

/** Mark activity (also persists `lastActiveAt`, best-effort). */
export function touchComputer(paths: ComputerPaths, session: ComputerSession): ComputerSession {
  const next = { ...session, lastActiveAt: now() };
  try {
    writeStateFile(paths, next);
  } catch {}
  return next;
}

export function appendActivity(entry: Omit<ActivityEntry, "at">, paths: ComputerPaths = getComputerPaths()): void {
  try {
    if (!existsSync(paths.logs)) mkdirSync(paths.logs, { recursive: true });
    const line = JSON.stringify({ at: now(), ...entry });
    appendFileSync(paths.activityFile, `${line}\n`, "utf-8");
    // Roll rather than grow forever; the newest half survives.
    const size = statSync(paths.activityFile).size;
    if (size > ACTIVITY_LIMIT_BYTES) {
      const lines = readFileSync(paths.activityFile, "utf-8").split("\n").filter(Boolean);
      const kept = lines.slice(Math.floor(lines.length / 2));
      writeFileSync(paths.activityFile, `${kept.join("\n")}\n`, "utf-8");
    }
  } catch (error) {
    console.warn("[computer] activity log write failed:", (error as Error)?.message || error);
  }
}

export function readActivity(limit = ACTIVITY_READ_LIMIT, paths: ComputerPaths = getComputerPaths()): ActivityEntry[] {
  try {
    if (!existsSync(paths.activityFile)) return [];
    const lines = readFileSync(paths.activityFile, "utf-8").split("\n").filter(Boolean);
    return lines
      .slice(-Math.max(1, Math.min(limit, 500)))
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as ActivityEntry;
          return parsed && typeof parsed.summary === "string" ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Bounded recursive size scan — the panel must never hang on a big tree. */
export function directoryUsage(dir: string, budget = 4000): { bytes: number; files: number; truncated: boolean } {
  let bytes = 0;
  let files = 0;
  let seen = 0;
  let truncated = false;
  const walk = (current: string) => {
    if (truncated) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > budget) {
        truncated = true;
        return;
      }
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files += 1;
        try {
          bytes += statSync(full).size;
        } catch {}
      }
    }
  };
  walk(dir);
  return { bytes, files, truncated };
}

export type ComputerStatus = {
  session: ComputerSession;
  paths: ComputerPaths;
  usage: { bytes: number; files: number; truncated: boolean };
  downloads: number;
  attachments: number;
  persistent: true;
  idle: "no background process";
  activity: ActivityEntry[];
};

export function getComputerStatus(): ComputerStatus {
  const { paths, session } = ensureComputer();
  const usage = directoryUsage(paths.home);
  const count = (dir: string) => {
    try {
      return readdirSync(dir).length;
    } catch {
      return 0;
    }
  };
  return {
    session,
    paths,
    usage,
    downloads: count(paths.downloads),
    attachments: count(paths.attachments),
    persistent: true,
    idle: "no background process",
    activity: readActivity(40, paths),
  };
}

export type ResetResult = {
  session: ComputerSession;
  removed: string[];
  kept: string[];
};

/**
 * Explicit reset: the only operation that deletes runtime state.
 * `keepAttachments` defaults to true — a reset is about the machine, not
 * about losing the files the user handed over.
 */
export async function resetComputer(options: { keepAttachments?: boolean } = {}): Promise<ResetResult> {
  const { paths, session } = ensureComputer();
  try {
    const { stopComputerBrowser } = await import("./browser");
    await stopComputerBrowser();
  } catch {}
  const wipe = [paths.home, paths.downloads, paths.browser, paths.logs, paths.tmp];
  if (options.keepAttachments === false) wipe.push(paths.attachments);
  const removed: string[] = [];
  for (const dir of wipe) {
    try {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch (error) {
      console.warn("[computer] reset could not remove", dir, (error as Error)?.message || error);
    }
  }
  ensureComputerDirs(paths);
  const next: ComputerSession = {
    version: 1,
    id: randomUUID(),
    createdAt: now(),
    lastActiveAt: now(),
    resets: session.resets + 1,
  };
  try {
    writeStateFile(paths, next);
  } catch {}
  const kept = options.keepAttachments === false ? [] : [relativeToRoot(paths, paths.attachments)];
  appendActivity({ kind: "reset", summary: `Computer reset (session ${next.id.slice(0, 8)})`, detail: options.keepAttachments === false ? "attachments removed" : "attachments kept" }, paths);
  return {
    session: next,
    removed: removed.map((p) => relativeToRoot(paths, p)),
    kept,
  };
}

function relativeToRoot(paths: ComputerPaths, target: string): string {
  return target === paths.root ? "." : target.slice(paths.root.length + 1).split("\\").join("/");
}
