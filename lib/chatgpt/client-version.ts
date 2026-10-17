import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";

/**
 * The ChatGPT-backend (Codex) model catalog is gated on the `client_version`
 * query parameter. A stale value silently hides every model except
 * `codex-auto-review`, which makes subscription chats look broken.
 *
 * Keep a bundled fallback for offline use, allow an explicit override, and
 * refresh from the current Codex CLI release on npm at most once a day.
 * The version is injected per request (see lib/chatgpt/handler.ts), so a
 * background refresh takes effect without recreating the handler.
 */
export const BUNDLED_CHATGPT_CLIENT_VERSION = "0.163.0";

const NPM_LATEST_URL = "https://registry.npmjs.org/@openai/codex/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;

type VersionCache = { version: string; fetchedAt: number };

let current = BUNDLED_CHATGPT_CLIENT_VERSION;
let loadedCache = false;
let inflight: Promise<void> | undefined;
let lastFailureAt = 0;

function cachePath(): string {
  return join(getDataDir(), ".memory", "chatgpt-client-version.json");
}

function isClientVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

function readCache(): VersionCache | undefined {
  try {
    const path = cachePath();
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (!isClientVersion(parsed?.version) || typeof parsed?.fetchedAt !== "number") return undefined;
    return { version: parsed.version, fetchedAt: parsed.fetchedAt };
  } catch {
    return undefined;
  }
}

function writeCache(cache: VersionCache): void {
  try {
    const dir = join(getDataDir(), ".memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(cache, null, 2), "utf-8");
  } catch {}
}

/** Current Codex client version: env override > cached release > bundled fallback. */
export function getChatGPTClientVersion(): string {
  if (process.env.LWC_CLIENT_VERSION) return process.env.LWC_CLIENT_VERSION;
  if (!loadedCache) {
    loadedCache = true;
    const cache = readCache();
    if (cache) current = cache.version;
  }
  return current;
}

/**
 * Refresh the Codex client version from the latest `@openai/codex` release.
 * Best-effort and cached for a day; failures keep the last known version.
 */
export function refreshChatGPTClientVersion(): Promise<void> {
  if (process.env.LWC_CLIENT_VERSION) return Promise.resolve();
  if (!loadedCache) getChatGPTClientVersion();

  const cache = readCache();
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    current = cache.version;
    return Promise.resolve();
  }
  if (inflight) return inflight;
  if (Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS) return Promise.resolve();

  inflight = (async () => {
    try {
      const res = await fetch(NPM_LATEST_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`npm registry ${res.status}`);
      const data = await res.json();
      if (!isClientVersion(data?.version)) throw new Error("invalid version");
      current = data.version;
      writeCache({ version: current, fetchedAt: Date.now() });
    } catch {
      lastFailureAt = Date.now();
    }
  })().finally(() => {
    inflight = undefined;
  });

  return inflight;
}
