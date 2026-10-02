"use client";

export interface CachedConnector {
  id: string;
  name: string;
  description: string;
  brandColor: string;
  icon: string;
  hasIcon: boolean;
  appUrl: string;
  connected: boolean;
}

const INSTANCE_KEY = "qube-instance-id";
// v2 cache: keyed per instance id. v1 used one global key, so a list fetched
// as the shared "qube-default-user" (before the UUID existed) poisoned every
// later view with someone else's connected flags.
const STORAGE_KEY_PREFIX = "qube-connectors-cache:v2:";
const STORAGE_TS_PREFIX = "qube-connectors-cache-ts:v2:";
// localStorage placeholder is usable for up to 10 min (instant open across
// restarts); in-memory is the hot path within a session.
const STORAGE_MAX_AGE_MS = 10 * 60 * 1000;

let memory: CachedConnector[] | null = null;
let memoryTs = 0;
let inflight: Promise<CachedConnector[]> | null = null;

function newInstanceId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
      return (crypto as any).randomUUID();
    }
  } catch {}
  return `iid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Single shared client identity. Synchronous + self-creating, so the very
 * first connector fetch already uses the real per-install UUID — never the
 * global default that collides across machines sharing the built-in key.
 */
export function getOrCreateInstanceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = localStorage.getItem(INSTANCE_KEY);
    // Treat the legacy shared default (and empties) as missing.
    if (existing && existing.trim() && existing !== "qube-default-user") return existing;
    const fresh = newInstanceId();
    localStorage.setItem(INSTANCE_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}

function getInstanceId(): string {
  return getOrCreateInstanceId();
}

function storageKey(): string {
  try {
    const iid = getOrCreateInstanceId();
    if (iid) return `${STORAGE_KEY_PREFIX}${iid}`;
  } catch {}
  return `${STORAGE_KEY_PREFIX}default`;
}

function storageTsKey(): string {
  try {
    const iid = getOrCreateInstanceId();
    if (iid) return `${STORAGE_TS_PREFIX}${iid}`;
  } catch {}
  return `${STORAGE_TS_PREFIX}default`;
}

let legacyPurged = false;
/** One-time: delete the v1 global cache (may hold another install's flags). */
function purgeLegacyCache() {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    localStorage.removeItem("qube-connectors-cache");
    localStorage.removeItem("qube-connectors-cache-ts");
  } catch {}
}

/** Synchronous instant placeholder: memory first, then localStorage. */
export function getCachedConnectors(): CachedConnector[] | null {
  if (memory && memory.length > 0) return memory;
  try {
    purgeLegacyCache();
    const ts = Number(localStorage.getItem(storageTsKey()) || 0);
    if (ts && Date.now() - ts > STORAGE_MAX_AGE_MS) return null;
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    memory = parsed;
    memoryTs = ts || Date.now();
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedConnectors(list: CachedConnector[]) {
  memory = list;
  memoryTs = Date.now();
  try {
    localStorage.setItem(storageKey(), JSON.stringify(list));
    localStorage.setItem(storageTsKey(), String(memoryTs));
  } catch {}
}

/**
 * Fetch the list, updating the shared cache. Deduplicates concurrent calls.
 * `fresh` bypasses the server-side TTL cache (use after connect/disconnect).
 * Never throws — returns cached data (or []) on failure so callers can
 * render instantly and refresh silently in the background.
 */
export async function fetchConnectorsList(opts?: {
  fresh?: boolean;
  timeoutMs?: number;
}): Promise<CachedConnector[]> {
  if (inflight) return inflight;
  const timeoutMs = opts?.timeoutMs ?? 8000;
  inflight = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const url =
        `/api/connectors/list?instanceId=${encodeURIComponent(getInstanceId())}` +
        (opts?.fresh ? "&fresh=1" : "");
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = (data.connectors || []) as CachedConnector[];
      if (list.length > 0) setCachedConnectors(list);
      else if (list.length === 0 && getCachedConnectors()) return getCachedConnectors()!;
      return list;
    } catch (e) {
      console.warn("[connectors-cache] fetch failed, using cached", e);
      return getCachedConnectors() || [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Fire-and-forget warm-up: no-op if memory was refreshed in the last 30s. */
export function prefetchConnectors() {
  try {
    if (memory && Date.now() - memoryTs < 30_000) return;
    void fetchConnectorsList();
  } catch {}
}
