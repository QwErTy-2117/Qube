/**
 * Updater logic — wraps Tauri's updater plugin with a web fallback.
 * Non-destructive: updates replace the app bundle only; data in app_data_dir
 * (.memory, workspace, etc.) and app_data_dir is preserved. No user data is wiped.
 */

export type UpdateInfo = {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
};

type CheckResult =
  | { available: true; info: UpdateInfo }
  | { available: false };

let cachedUpdate: any = null; // holds Tauri Update object for install

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

// Try to dynamically import Tauri updater to avoid bundling errors in web
async function tauriCheck(): Promise<CheckResult> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      cachedUpdate = update;
      return {
        available: true,
        info: {
          version: update.version,
          currentVersion: update.currentVersion,
          body: update.body,
          date: update.date,
        },
      };
    }
    cachedUpdate = null;
    return { available: false };
  } catch (e) {
    // Not in Tauri, or plugin not available, or dev build without updater artifacts
    // console.debug("[updater] tauri check failed", e);
    cachedUpdate = null;
    return { available: false };
  }
}

async function webFallbackCheck(): Promise<CheckResult> {
  // Web/dev fallback: compare via GitHub releases API for Qube.
  // In web (non-Tauri) we cannot auto-install via Tauri updater, so we
  // show the toast as if an update is available and then open the releases page.
  // This allows testing the UI without bundling Tauri.
  try {
    const res = await fetch(
      "https://api.github.com/repos/QwErTy-2117/Qube/releases/latest",
      { headers: { Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) return { available: false };
    const data = await res.json();
    const latest = (data.tag_name as string) || "";
    const cleanLatest = latest.replace(/^v/, "");
    // Get current version from settings or package.json version via /api/settings
    let current = "0.0.0";
    try {
      const s = await fetch("/api/settings").then((r) => r.json());
      if (s?.version) current = s.version;
    } catch {}
    if (cleanLatest && cleanLatest !== current) {
      // Simple semver compare: if different, assume update available
      // In web we can't know if newer; show as available if mismatch
      // Could do proper compare, but keep simple
      const isNewer = cleanLatest.localeCompare(current, undefined, { numeric: true }) > 0;
      if (!isNewer) return { available: false };
      return {
        available: true,
        info: {
          version: cleanLatest,
          currentVersion: current,
          body: data.body?.slice(0, 500),
          date: data.published_at,
        },
      };
    }
  } catch {}
  return { available: false };
}

export async function checkForUpdates(): Promise<CheckResult> {
  if (isTauri()) {
    const r = await tauriCheck();
    if (r.available) return r;
    // In Tauri but no update via plugin (dev or no artifacts), don't fallback to web in Tauri
    return r;
  } else {
    // In browser dev, use fallback to still show toast for demo
    return webFallbackCheck();
  }
}

export async function downloadAndInstall(
  onProgress?: (ev: { event: string; data: any }) => void
): Promise<void> {
  if (isTauri() && cachedUpdate) {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    let downloaded = 0;
    let contentLength: number | undefined;
    await cachedUpdate.downloadAndInstall((event: any) => {
      if (onProgress) onProgress(event);
      // Also track for internal logging
      if (event.event === "Started") contentLength = event.data.contentLength;
      if (event.event === "Progress") downloaded += event.data.chunkLength;
    });
    // Note: on Windows, app auto-exits during install. On other platforms, we relaunch.
    // Preserve data: installMode=passive only replaces bundle; app_data_dir is untouched.
    await relaunch();
    return;
  }

  // Web fallback: open releases page for Qube
  window.open("https://github.com/QwErTy-2117/Qube/releases/latest", "_blank");
}

export function getCachedUpdate(): any {
  return cachedUpdate;
}

export function clearCachedUpdate() {
  cachedUpdate = null;
}
