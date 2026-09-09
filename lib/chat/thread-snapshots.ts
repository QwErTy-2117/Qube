import { readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

const SNAP_DIR = join(getDataDir(), ".memory", "thread-messages");

function ensureDir() {
  if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
}

function snapPath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "thread";
  return join(SNAP_DIR, `${safe}.json`);
}

export type ThreadTitleSource = "heuristic" | "auto" | "manual";

export type ThreadSnapshot = {
  id: string;
  title: string;
  updatedAt: number;
  repository: unknown;
  /** How the title was set. Manual renames always win over automatic ones. */
  titleSource?: ThreadTitleSource;
};

function messageText(m: any): string {
  // v2 snapshots store AI SDK UIMessages ({ role, parts }); legacy stored
  // ThreadMessages ({ role, content }).
  const parts = Array.isArray(m?.parts) ? m.parts : Array.isArray(m?.content) ? m.content : [];
  return parts
    .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Plain-text extraction from a snapshot repo (v2 UI-message or legacy shape). */
export function snapshotText(repository: any, maxChars = 4000): string {
  try {
    const items: any[] = repository?.messages ?? [];
    const out: string[] = [];
    for (const item of items) {
      const m = item?.message ?? item;
      const parts = Array.isArray(m?.parts) ? m.parts : Array.isArray(m?.content) ? m.content : [];
      for (const p of parts) {
        if (typeof p?.text === "string" && p.text.trim()) out.push(p.text.trim());
      }
      if (out.join("\n").length >= maxChars) break;
    }
    return out.join("\n").slice(0, maxChars);
  } catch {
    return "";
  }
}

/** v2 repositories store AI SDK UIMessages (restorable); legacy stored ThreadMessages. */
export function isUIMessageRepository(repository: any): boolean {
  try {
    const messages: any[] = repository?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return repository?.version === 2;
    const first = messages[0]?.message;
    return Array.isArray(first?.parts);
  } catch {
    return false;
  }
}

/** Derive a short human title from the first user message in an exported repository. */
export function deriveTitleFromRepository(repository: any): string | null {
  try {
    const messages: any[] = repository?.messages;
    if (!Array.isArray(messages)) return null;
    for (const item of messages) {
      const m = item?.message ?? item;
      const role = m?.role;
      if (role !== "user") continue;
      const text = messageText(m).replace(/\s+/g, " ").trim();
      if (!text) continue;
      // First sentence-ish, capped at ~48 chars without cutting mid-word harshly.
      const cut = text.slice(0, 60);
      const words = cut.split(" ").slice(0, 7).join(" ");
      return (words.length > 48 ? words.slice(0, 48).trimEnd() + "…" : words) || null;
    }
    return null;
  } catch {
    return null;
  }
}

export function isPlaceholderTitle(title: string | undefined | null): boolean {
  if (!title) return true;
  const t = title.trim().toLowerCase();
  return t === "" || t === "new chat" || t === "new thread" || t === "conversation" || t === "untitled";
}

export async function saveThreadSnapshot(
  id: string,
  repository: unknown,
  title?: string,
  source?: ThreadTitleSource,
): Promise<ThreadSnapshot> {
  ensureDir();
  const existing = await readThreadSnapshot(id).catch(() => null);
  let finalTitle = (title ?? "").trim();
  let finalSource: ThreadTitleSource | undefined = source;
  if (
    !finalSource &&
    (existing?.titleSource === "auto" || existing?.titleSource === "manual") &&
    existing?.title
  ) {
    // Agent/user titles always win over later heuristic saves.
    finalTitle = existing.title;
    finalSource = existing.titleSource;
  } else if (isPlaceholderTitle(finalTitle)) {
    const derived = deriveTitleFromRepository(repository);
    if (derived) {
      finalTitle = derived;
      finalSource = finalSource ?? "heuristic";
    } else if (existing?.title) {
      finalTitle = existing.title;
      finalSource = finalSource ?? existing.titleSource;
    } else {
      finalTitle = "New Chat";
    }
  }
  finalTitle = finalTitle.slice(0, 120);
  const snap: ThreadSnapshot = {
    id,
    title: finalTitle,
    updatedAt: Date.now(),
    repository: repository ?? existing?.repository ?? null,
    titleSource: finalSource ?? existing?.titleSource,
  };
  await writeFile(snapPath(id), JSON.stringify(snap), "utf-8");
  return snap;
}

export async function readThreadSnapshot(id: string): Promise<ThreadSnapshot | null> {
  try {
    const data = await readFile(snapPath(id), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function deleteThreadSnapshot(id: string): Promise<void> {
  await unlink(snapPath(id)).catch(() => {});
}

export async function listThreadSnapshotIds(): Promise<Set<string>> {
  try {
    ensureDir();
    const files = await readdir(SNAP_DIR);
    return new Set(
      files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)),
    );
  } catch {
    return new Set();
  }
}
