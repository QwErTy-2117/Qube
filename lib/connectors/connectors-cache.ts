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

const STORAGE_KEY = "qube-connectors-cache";
const STORAGE_TS_KEY = "qube-connectors-cache-ts";
// localStorage placeholder is usable for up to 10 min (instant open across
// restarts); in-memory is the hot path within a session.
const STORAGE_MAX_AGE_MS = 10 * 60 * 1000;

let memory: CachedConnector[] | null = null;
let memoryTs = 0;
let inflight: Promise<CachedConnector[]> | null = null;

function getInstanceId(): string {
  if (typeof window === "undefined") return "qube-default-user";
  try {
    return localStorage.getItem("qube-instance-id") || "qube-default-user";
  } catch {
    return "qube-default-user";
  }
}

/** Synchronous instant placeholder: memory first, then localStorage. */
export function getCachedConnectors(): CachedConnector[] | null {
  if (memory && memory.length > 0) return memory;
  try {
    const ts = Number(localStorage.getItem(STORAGE_TS_KEY) || 0);
    if (ts && Date.now() - ts > STORAGE_MAX_AGE_MS) return null;
    const raw = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    localStorage.setItem(STORAGE_TS_KEY, String(memoryTs));
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
