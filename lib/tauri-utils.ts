/**
 * Version of the desktop binary, straight from Tauri.
 *
 * The version shown in Settings must never come from the sidecar copy: after an
 * in-place update that copy can be older than the binary (see the version stamp
 * in `src-tauri/src/sidecar.rs`), which made a current install display the
 * previous release forever. Returns null outside Tauri or when unavailable.
 */
export async function getTauriAppVersion(): Promise<string | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const version = await getVersion();
    return version || null;
  } catch {
    return null;
  }
}

export async function syncTauriAutostart(enable: boolean) {
  if (typeof window !== "undefined") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_autostart", { enable });
    } catch {
      // Not in Tauri or API not present
    }
  }
}
