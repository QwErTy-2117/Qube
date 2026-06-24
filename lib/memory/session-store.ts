import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SESSIONS_DIR = join(process.cwd(), ".memory", "sessions");
const MAX_TRANSCRIPT_SIZE = 1024 * 1024;

export type SessionRecord = {
  id: string;
  title: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
  hasTranscript: boolean;
};

export type SessionWithTranscript = SessionRecord & {
  transcript: string;
};

function ensureDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sessionPath(id: string): string {
  return join(SESSIONS_DIR, `${id}.json`);
}

export async function saveSession(
  id: string,
  title: string,
  summary: string,
  transcript?: string,
  storeTranscript = false,
): Promise<void> {
  ensureDir();
  const record: SessionRecord & { transcript?: string } = {
    id,
    title,
    summary,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hasTranscript: !!transcript && storeTranscript,
  };
  if (transcript && storeTranscript) {
    if (transcript.length > MAX_TRANSCRIPT_SIZE) {
      record.transcript = transcript.slice(0, MAX_TRANSCRIPT_SIZE) + "\n... [truncated]";
    } else {
      record.transcript = transcript;
    }
  }
  await writeFile(sessionPath(id), JSON.stringify(record, null, 2), "utf-8");
}

export async function updateSessionSummary(
  id: string,
  title: string,
  summary: string,
): Promise<void> {
  const existing = await readSession(id).catch(() => null);
  if (!existing) return;
  existing.title = title;
  existing.summary = summary;
  existing.updatedAt = Date.now();
  await writeFile(sessionPath(id), JSON.stringify(existing, null, 2), "utf-8");
}

export async function readSession(id: string): Promise<SessionWithTranscript | null> {
  try {
    const data = await readFile(sessionPath(id), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function readSessionSummary(id: string): Promise<SessionRecord | null> {
  const session = await readSession(id);
  if (!session) return null;
  const { transcript: _, ...record } = session;
  return record;
}

export async function listSessions(): Promise<SessionRecord[]> {
  ensureDir();
  const files = await readdir(SESSIONS_DIR);
  const sessions: SessionRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = await readFile(join(SESSIONS_DIR, file), "utf-8");
      const parsed = JSON.parse(data);
      const { transcript: _, ...record } = parsed;
      sessions.push(record);
    } catch {
      continue;
    }
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions;
}

export async function deleteSession(id: string): Promise<void> {
  await unlink(sessionPath(id)).catch(() => {});
}
