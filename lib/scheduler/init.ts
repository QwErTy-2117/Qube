let started = false;

export function ensureSchedulerStarted() {
  if (started) return;
  started = true;
  import("./scheduler").then(({ startScheduler }) => {
    startScheduler();
  }).catch((err) => {
    console.error("[scheduler-init] Failed to start scheduler:", err);
  });
}
