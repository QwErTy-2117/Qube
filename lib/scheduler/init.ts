import { schedulerRuntime } from "./runtime-state";

export function ensureSchedulerStarted() {
  const rt = schedulerRuntime();
  if (rt.started || rt.paused > 0) return;
  rt.started = true;
  import("./scheduler").then(({ startScheduler }) => {
    startScheduler();
  }).catch((err) => {
    // Allow a later request to retry startup if the dynamic import failed.
    rt.started = false;
    console.error("[scheduler-init] Failed to start scheduler:", err);
  });
}
