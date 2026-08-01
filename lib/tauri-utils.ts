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
