/**
 * Client-side "last checked" bookkeeping for the sidebar unread dot.
 *
 * A thread is unread only when its last message is newer than the moment the
 * user last opened (or was actively viewing) it. Keeping the timestamps in
 * localStorage makes the indicator survive reloads without adding a server
 * write to every message stream.
 */

export const THREAD_SEEN_STORAGE_KEY = "qube-thread-seen";

export type ThreadSeenMap = Record<string, number>;

export function threadTimestamp(
  value: Date | string | number | null | undefined,
): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof (value as { getTime?: unknown }).getTime === "function") {
    try {
      return (value as { getTime: () => number }).getTime();
    } catch {
      return 0;
    }
  }
  return 0;
}

export function isThreadUnread(
  lastMessageAt: Date | string | number | null | undefined,
  seenAt: number | null | undefined,
): boolean {
  const last = threadTimestamp(lastMessageAt);
  if (!last) return false;
  return last > (seenAt ?? 0);
}

export function parseThreadSeen(raw: string | null | undefined): ThreadSeenMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const seen: ThreadSeenMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) seen[id] = value;
    }
    return seen;
  } catch {
    return {};
  }
}
