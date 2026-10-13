import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrCreateConversation } from "@/lib/pi/durable-conversations";
import { listSessions, readSession } from "@/lib/memory/session-store";

export function migrateThreadRecord(rec: { id: string; title: string }) {
  return { id: rec.id.slice(0, 128), title: rec.title.slice(0, 120) || "New Chat" };
}

export type ParsedHistoryLine = { role: "user" | "assistant" | "note"; text: string };

const ROLE_PREFIX = /^(user|assistant|system|tool)\s*:\s?(.*)$/;

/**
 * Parse a Qube session transcript ("role: text" lines, multi-line texts
 * continue until the next role prefix) into history blocks. Consecutive
 * same-role lines merge; system/tool map to assistant context.
 */
export function parseTranscriptLines(transcript: string): ParsedHistoryLine[] {
  const out: ParsedHistoryLine[] = [];
  if (!transcript || !transcript.trim()) return out;
  const push = (role: ParsedHistoryLine["role"], text: string) => {
    const clean = text.replace(/\s+$/, "");
    if (!clean) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += "\n" + clean;
    else out.push({ role, text: clean });
  };
  let currentRole: ParsedHistoryLine["role"] | null = null;
  let currentText = "";
  const flush = () => {
    if (currentRole) push(currentRole, currentText);
    currentRole = null;
    currentText = "";
  };
  for (const line of transcript.split("\n")) {
    const m = ROLE_PREFIX.exec(line);
    if (m) {
      flush();
      currentRole = m[1] === "user" ? "user" : m[1] === "assistant" ? "assistant" : "note";
      currentText = m[2] ?? "";
    } else if (currentRole) {
      currentText += "\n" + line;
    } else if (line.trim()) {
      currentRole = "note";
      currentText = line;
    }
  }
  flush();
  return out;
}

export type MigrationResult = { migrated: string[]; skipped: string[] };

/**
 * Import Qube sessions into durable conversations. Idempotent: threads
 * whose conversation already holds entries are skipped. Titles land in
 * the thread-map; transcript blocks land as qube.history data entries
 * (content preserved and queryable; model-visible history is follow-up).
 */
export async function migrateSessions(
  context = BACKGROUND_CONTEXT,
  opts?: { limit?: number },
): Promise<MigrationResult> {
  const { setThreadTitle } = await import("@/lib/pi/durable-conversations");
  const sessions = await listSessions();
  const result: MigrationResult = { migrated: [], skipped: [] };
  let count = 0;
  for (const s of sessions) {
    if (opts?.limit !== undefined && count >= opts.limit) break;
    const { id, title } = migrateThreadRecord({ id: s.id, title: s.title });
    const conv = await getOrCreateConversation(id, context);
    const existing = await conv.commit(
      (tx) => tx.scanEntries({ conversationId: conv.id, order: "ascending" }, 1),
      context,
    );
    if (existing.items.length > 0) {
      result.skipped.push(id);
      continue;
    }
    const full = await readSession(s.id).catch(() => null);
    const blocks = parseTranscriptLines(full?.transcript ?? "");
    await conv.commit(async (tx) => {
      for (const b of blocks.slice(0, 500)) {
        await tx.appendEntry(conv.id, { kind: "qube.history", data: { role: b.role, text: b.text.slice(0, 8000) } });
      }
    }, context);
    await setThreadTitle(id, title, context);
    result.migrated.push(id);
    count++;
  }
  return result;
}
