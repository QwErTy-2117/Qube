/**
 * Browser-side hard-reset cleanup.
 *
 * Server-side reset removes files, but the webview keeps its own origin-scoped
 * state: localStorage (theme, provider drafts, cached model ids), session
 * storage, IndexedDB, Cache Storage, cookies, and service workers. Clearing
 * only localStorage leaves recoverable data behind and can resurrect stale
 * settings on reload. This module clears every browser store we can access.
 *
 * The desktop shell has a second layer (`finalize_hard_reset`) that clears the
 * webview's native browsing data and deletes the app data/cache directories.
 */

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function clearDocumentCookies(): void {
  try {
    for (const entry of document.cookie.split(";")) {
      const name = entry.split("=")[0]?.trim();
      if (!name) continue;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
    }
  } catch {
    // Cookie access can be blocked by the webview; native browsing-data
    // clearing in the desktop shell still covers it.
  }
}

function deleteIndexedDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      const done = () => resolve();
      request.onsuccess = done;
      request.onerror = done;
      request.onblocked = done;
    } catch {
      resolve();
    }
  });
}

async function clearIndexedDatabases(): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") return;
    const databases = typeof indexedDB.databases === "function"
      ? await indexedDB.databases()
      : [];
    await Promise.all(
      databases
        .map((database) => database?.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
        .map((name) => deleteIndexedDatabase(name)),
    );
  } catch {
    // Some engines don't expose databases(); nothing else can be enumerated.
  }
}

async function clearCacheStorage(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {}
}

async function clearServiceWorkers(): Promise<void> {
  try {
    if (!navigator.serviceWorker) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {}
}

/** Clear every origin-scoped store available to the current webview. */
export async function clearClientStorageForHardReset(): Promise<void> {
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  clearDocumentCookies();
  await Promise.all([
    clearIndexedDatabases(),
    clearCacheStorage(),
    clearServiceWorkers(),
  ]);
}

/**
 * Ask the desktop shell to finish the reset: clear native browsing data and
 * caches, stop the sidecar, delete the app data directory, start a fresh
 * sidecar, and navigate to it. Returns false outside Tauri or for dev builds
 * where the shell has no bundled sidecar to restart.
 */
export async function finalizeTauriHardReset(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return Boolean(await invoke<boolean>("finalize_hard_reset"));
}
