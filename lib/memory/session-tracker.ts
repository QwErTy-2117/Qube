import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TRACKER_FILE = join(process.cwd(), ".memory", "session-tracker.json");

type SessionTracker = {
  lastThreadId: string | null;
};

async function readTracker(): Promise<SessionTracker> {
  try {
    const data = await readFile(TRACKER_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { lastThreadId: null };
  }
}

async function writeTracker(tracker: SessionTracker): Promise<void> {
  const dir = join(process.cwd(), ".memory");
  const { existsSync, mkdirSync } = await import("node:fs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFile(TRACKER_FILE, JSON.stringify(tracker), "utf-8");
}

export async function getLastThreadId(): Promise<string | null> {
  const tracker = await readTracker();
  return tracker.lastThreadId;
}

export async function setLastThreadId(threadId: string): Promise<void> {
  await writeTracker({ lastThreadId: threadId });
}
