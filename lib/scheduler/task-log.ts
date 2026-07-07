import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type TaskLogEntry } from "./types";

const DATA_DIR = join(process.cwd(), ".memory");
const LOG_FILE = join(DATA_DIR, "task-log.jsonl");
const MAX_LOG_ENTRIES = 1000;

async function ensureLogFile() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

export async function appendLog(entry: TaskLogEntry): Promise<void> {
  await ensureLogFile();
  await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
}

export async function getLog(limit = 50): Promise<TaskLogEntry[]> {
  await ensureLogFile();
  if (!existsSync(LOG_FILE)) return [];
  const raw = await readFile(LOG_FILE, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);
  const entries: TaskLogEntry[] = lines.map((l) => JSON.parse(l));
  return (
    entries
      .slice(-Math.min(limit, entries.length))
      .reverse()
  );
}

export async function pruneLog(): Promise<void> {
  await ensureLogFile();
  if (!existsSync(LOG_FILE)) return;
  const raw = await readFile(LOG_FILE, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);
  if (lines.length <= MAX_LOG_ENTRIES) return;
  const pruned = lines.slice(lines.length - MAX_LOG_ENTRIES);
  await appendFile(LOG_FILE, pruned.join("\n") + "\n", "utf-8");
}
