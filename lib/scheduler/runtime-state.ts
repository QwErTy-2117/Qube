/**
 * Process-wide scheduler runtime.
 *
 * Next.js route bundles can contain separate module instances, but a hard
 * reset must pause the scheduler for all of them. Keeping the interval handle,
 * active-tick flag, and reset epoch on globalThis makes that coordination
 * reliable without requiring a server restart.
 */

export interface SchedulerRuntimeState {
  tickInterval: ReturnType<typeof setInterval> | null;
  running: boolean;
  started: boolean;
  missedExecutions: Map<string, number>;
  /** Non-zero while a hard reset is in progress. */
  paused: number;
  /** Incremented when a hard reset begins; work started in an older epoch is stale. */
  epoch: number;
  /** Epoch of the tick that currently owns `running`; prevents stale finally blocks. */
  activeTickEpoch: number | null;
  wasRunningBeforePause: boolean;
}

const KEY = "__qube_scheduler_runtime__";

type SchedulerGlobal = typeof globalThis & {
  [KEY]?: SchedulerRuntimeState;
};

export function schedulerRuntime(): SchedulerRuntimeState {
  const g = globalThis as SchedulerGlobal;
  if (!g[KEY]) {
    g[KEY] = {
      tickInterval: null,
      running: false,
      started: false,
      missedExecutions: new Map<string, number>(),
      paused: 0,
      epoch: 0,
      activeTickEpoch: null,
      wasRunningBeforePause: false,
    };
  }
  return g[KEY]!;
}

export function isSchedulerPaused(): boolean {
  return schedulerRuntime().paused > 0;
}

export function currentSchedulerEpoch(): number {
  return schedulerRuntime().epoch;
}

/** True when work captured in `epoch` must not write state after a reset. */
export function isStaleSchedulerEpoch(epoch: number): boolean {
  const rt = schedulerRuntime();
  return rt.paused > 0 || epoch !== rt.epoch;
}

export interface SchedulerHardResetPause {
  waitForIdle: (timeoutMs?: number) => Promise<boolean>;
  resume: () => Promise<void>;
}

/**
 * Stop new ticks and invalidate any in-flight heartbeat/scheduled work.
 * The caller aborts active model/tool runs, waits for idle, clears data, then
 * resumes. A previously running scheduler is restarted with a fresh task
 * cache; a scheduler that had not started stays lazy-started.
 */
export async function pauseSchedulerForHardReset(): Promise<SchedulerHardResetPause> {
  const rt = schedulerRuntime();
  rt.paused += 1;
  rt.epoch += 1;
  rt.wasRunningBeforePause = rt.tickInterval !== null;
  if (rt.tickInterval) {
    clearInterval(rt.tickInterval);
    rt.tickInterval = null;
  }

  const waitForIdle = async (timeoutMs = 5_000): Promise<boolean> => {
    const started = Date.now();
    while (rt.running && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (rt.running) {
      // Work that ignored cancellation must not block a user-requested reset.
      // Its epoch is already stale, so its later writes are gated in scheduler.
      rt.running = false;
      rt.activeTickEpoch = null;
      return false;
    }
    return true;
  };

  const resume = async (): Promise<void> => {
    rt.paused = Math.max(0, rt.paused - 1);
    if (rt.paused > 0) return;
    rt.missedExecutions.clear();
    rt.running = false;
    rt.started = rt.wasRunningBeforePause;
    if (rt.wasRunningBeforePause) {
      const { startScheduler } = await import("./scheduler");
      startScheduler();
    }
    rt.wasRunningBeforePause = false;
  };

  return { waitForIdle, resume };
}
