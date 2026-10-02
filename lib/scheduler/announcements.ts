/**
 * Pending announcements — completed scheduled-task results the user has
 * not been told about yet.
 *
 * The bug this fixes: a scheduled task (e.g. "Daily AI News Report")
 * finished successfully, but the next chat opened with a generic greeting
 * and only mentioned the report when the user explicitly asked
 * ("don't you have anything to tell me?"). The task log recap is passive —
 * the agent treats it as background context, not as something to volunteer.
 *
 * Flow:
 * 1. scheduler.executeScheduledTask records an announcement on success
 *    (meaningful output only; heartbeat ticks never create these).
 * 2. Every chat turn injects undelivered announcements as
 *    <pending_announcements> with a MUST-lead directive (see
 *    buildHeartbeatBrief) — the agent opens its reply with them.
 * 3. The chat route marks the injected ids delivered after the turn's
 *    reply streams successfully, so each result is announced exactly once.
 *    A failed turn leaves them pending for the next turn.
 *
 * Static imports only — no lazy require (require is undefined in ESM
 * test/prod contexts and must never be load-bearing).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { hashContent } from "@/lib/proactivity/store";

const FILE = () => join(getDataDir(), ".memory", "announcements.json");
const MAX_STORED = 20;
const DELIVERED_TTL_MS = 7 * 86_400_000;
const MAX_EXCERPT_CHARS = 600;

export interface Announcement {
  id: string;
  taskId: string;
  taskName: string;
  excerpt: string;
  createdAt: number;
  deliveredAt: number | null;
  hash: string;
}

function defaults(): { version: number; items: Announcement[] } {
  return { version: 1, items: [] };
}

async function ensureDir() {
  const dir = join(getDataDir(), ".memory");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function loadAll(): Promise<{ version: number; items: Announcement[] }> {
  await ensureDir();
  if (!existsSync(FILE())) return defaults();
  try {
    const raw = await readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return defaults();
    return { version: 1, items: parsed.items };
  } catch {
    return defaults();
  }
}

async function saveAll(items: Announcement[]): Promise<void> {
  await ensureDir();
  await writeFile(FILE(), JSON.stringify({ version: 1, items }, null, 2), "utf-8");
}

/** Outputs with no user-visible news must never page the user. */
export function isMeaningfulResult(output: string): boolean {
  const t = (output || "").trim();
  if (t.length < 20) return false;
  const norm = t.toLowerCase();
  if (norm === "(no output)") return false;
  if (/^heartbeat_ok\b/.test(norm)) return false;
  if (/^cancelled:/.test(norm)) return false;
  return true;
}

function fingerprint(taskId: string, output: string): string {
  return hashContent(`${taskId} :: ${output}`.toLowerCase().slice(0, 2000));
}

/**
 * Record a completed scheduled-task result for proactive announcement.
 * Returns the existing record when the identical result is already pending
 * (same task + same output hash), so re-runs never double-announce.
 */
export async function recordAnnouncement(opts: {
  taskId: string;
  taskName: string;
  output: string;
}): Promise<Announcement | null> {
  const output = (opts.output || "").trim();
  if (!isMeaningfulResult(output)) return null;
  const { items } = await loadAll();
  const now = Date.now();
  const hash = fingerprint(opts.taskId, output);
  const dupe = items.find((a) => a.taskId === opts.taskId && a.hash === hash && !a.deliveredAt);
  if (dupe) return dupe;

  const rec: Announcement = {
    id: `ann_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    taskId: opts.taskId,
    taskName: opts.taskName.slice(0, 120) || opts.taskId,
    excerpt: output.slice(0, MAX_EXCERPT_CHARS),
    createdAt: now,
    deliveredAt: null,
    hash,
  };
  const next = [...items, rec];
  // Bound the store: prune old delivered first, then oldest overall.
  const pruned = next
    .filter((a) => !(a.deliveredAt && now - a.deliveredAt > DELIVERED_TTL_MS))
    .sort((a, b) => a.createdAt - b.createdAt);
  while (pruned.length > MAX_STORED) {
    const idx = pruned.findIndex((a) => a.deliveredAt);
    pruned.splice(idx >= 0 ? idx : 0, 1);
  }
  await saveAll(pruned);
  return rec;
}

/** Undelivered announcements, oldest first (bounded for prompt size). */
export async function getPendingAnnouncements(limit = 5): Promise<Announcement[]> {
  const { items } = await loadAll();
  return items
    .filter((a) => !a.deliveredAt)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(1, limit));
}

/** Mark announcements as told-to-user. Only call after a reply streamed. */
export async function markAnnouncementsDelivered(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { items } = await loadAll();
  const set = new Set(ids);
  let changed = false;
  for (const a of items) {
    if (set.has(a.id) && !a.deliveredAt) {
      a.deliveredAt = Date.now();
      changed = true;
    }
  }
  if (changed) await saveAll(items);
}
