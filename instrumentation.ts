/**
 * Next.js server instrumentation.
 *
 * Qube's scheduler (heartbeat + exact-time scheduled tasks) must run while the
 * app is open, not only after the first chat or scheduling request. Starting it
 * here means background monitoring begins with the Node server — including the
 * Tauri sidecar's standalone server — and keeps ticking until shutdown.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureSchedulerStarted } = await import("./lib/scheduler/init");
    ensureSchedulerStarted();
  } catch (error) {
    console.error("[instrumentation] Failed to start the scheduler:", error);
  }
}
