/**
 * Coordinated server-side hard reset.
 *
 * A hard reset must return Qube to a genuinely fresh state, not merely delete
 * a static list of JSON files. It now:
 * 1. pauses scheduler ticks and invalidates in-flight background work;
 * 2. aborts model runs and closes the durable SQLite harness / managed browser
 *    so their files can actually be removed;
 * 3. clears in-memory caches that could otherwise resurrect deleted state;
 * 4. drains and removes the global announcement and heartbeat-work ledgers;
 * 5. removes every app-state file under .memory, including nested directories;
 * 6. removes the experimental durable DB and browser profile; and
 * 7. installs a fresh default task cache before restarting the scheduler.
 *
 * Workspace deliverables, sidecar logs, bundled skills, and application code
 * are deliberately preserved. Server-side state is never treated as trusted
 * instructions; it is only data being deleted at the user's explicit request.
 */

import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
import { pauseSchedulerForHardReset } from "@/lib/scheduler/runtime-state";
import { clearAnnouncementsForHardReset } from "@/lib/scheduler/announcements";
import { clearHeartbeatWorkForHardReset } from "@/lib/proactivity/heartbeat-work";
import { resetTasksForHardReset } from "@/lib/scheduler/task-store";

export interface HardResetResult {
  ok: boolean;
  dataDir: string;
  removed: string[];
  errors: string[];
  warnings: string[];
}

interface HardResetGlobalState {
  promise?: Promise<HardResetResult>;
}

const GLOBAL_KEY = "__qube_hard_reset__";

type HardResetGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: HardResetGlobalState;
};

function hardResetGlobal(): HardResetGlobalState {
  const g = globalThis as HardResetGlobal;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = {};
  return g[GLOBAL_KEY]!;
}

/** Documented, app-owned state locations inside the application data dir. */
export function hardResetPaths(dataDir = getDataDir()): string[] {
  return [
    // Every settings, provider, chat, memory, scheduler, connector, goal,
    // announcement, work-ledger, and nested session/scratchpad file.
    join(dataDir, ".memory"),
    // Experimental durable runtime (main DB plus SQLite sidecars).
    join(dataDir, "agent.sqlite"),
    join(dataDir, "agent.sqlite-shm"),
    join(dataDir, "agent.sqlite-wal"),
    join(dataDir, "agent.sqlite-journal"),
    // Managed-browser cookies, sessions, and legacy browser state.
    join(dataDir, ".browser-profile"),
    join(dataDir, ".camoufox"),
    join(dataDir, ".camoufox-profile"),
    join(dataDir, ".playwright-mcp"),
    join(dataDir, ".superpowers"),
  ];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function attempt(
  label: string,
  fn: () => void | Promise<void>,
  sink: string[],
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    sink.push(`${label}: ${messageOf(error)}`);
  }
}

async function abortBackgroundWork(warnings: string[]): Promise<void> {
  await attempt("durable harness", async () => {
    const { closeDurableHarness } = await import("@/lib/pi/durable");
    await closeDurableHarness();
  }, warnings);
  await attempt("Pi harness", async () => {
    const { shutdownPiHarness } = await import("@/lib/pi/harness");
    await shutdownPiHarness();
  }, warnings);
  await attempt("background tasks", async () => {
    const { abortAllPiTasksForHardReset } = await import("@/lib/pi/task-runner");
    abortAllPiTasksForHardReset();
  }, warnings);
  await attempt("ACP sessions", async () => {
    const { clearAcpSessionsForHardReset } = await import("@/lib/acp/sessions");
    clearAcpSessionsForHardReset();
  }, warnings);
  await attempt("managed browser", async () => {
    const { stopManagedChromeForHardReset } = await import("@/lib/browser/managed-chrome");
    await stopManagedChromeForHardReset();
  }, warnings);
}

async function clearRuntimeCaches(warnings: string[]): Promise<void> {
  await attempt("provider cache", async () => {
    const { providerStore } = await import("@/lib/pi/provider-store");
    providerStore.resetForHardReset();
  }, warnings);
  await attempt("settings cache", async () => {
    const { settingsStore } = await import("@/lib/settings-store");
    settingsStore.resetForHardReset();
  }, warnings);
  await attempt("memory cache", async () => {
    const { resetMemoryRuntimeForHardReset } = await import("@/lib/memory/memory-store");
    await resetMemoryRuntimeForHardReset();
  }, warnings);
  await attempt("MCP cache", async () => {
    const { mcpStore } = await import("@/lib/pi/mcp-store");
    mcpStore.resetForHardReset();
  }, warnings);
  await attempt("skill cache", async () => {
    const { skillStore } = await import("@/lib/skills/store");
    skillStore.resetForHardReset();
  }, warnings);
  await attempt("allowed directories", async () => {
    const { allowedDirsStore } = await import("@/lib/permissions/allowed-dirs");
    allowedDirsStore.resetForHardReset();
  }, warnings);
  await attempt("connector key", async () => {
    const { composioKeyStore } = await import("@/lib/connectors/composio-key-store");
    composioKeyStore.resetForHardReset();
  }, warnings);
  await attempt("connector runtime", async () => {
    const { resetComposioRuntimeForHardReset } = await import("@/lib/connectors/composio");
    resetComposioRuntimeForHardReset();
  }, warnings);
  await attempt("ChatGPT sessions", async () => {
    const { clearChatGPTSessionsForHardReset } = await import("@/lib/chatgpt/handler");
    clearChatGPTSessionsForHardReset();
  }, warnings);
  await attempt("ChatGPT client version", async () => {
    const { resetChatGPTClientVersionForHardReset } = await import("@/lib/chatgpt/client-version");
    resetChatGPTClientVersionForHardReset();
  }, warnings);
  await attempt("browser page state", async () => {
    const { browserStore } = await import("@/lib/agent/browser/browser-store");
    browserStore.resetForHardReset();
  }, warnings);
  await attempt("browser cookies", async () => {
    const { clearCookieJar } = await import("@/lib/browser/cookie-jar");
    clearCookieJar();
  }, warnings);
  await attempt("durable browser runtime", async () => {
    const { resetDurableBrowserForHardReset } = await import("@/lib/pi/durable-browser");
    resetDurableBrowserForHardReset();
  }, warnings);
  await attempt("computer-use runtime", async () => {
    const { resetComputerUseRuntimeForHardReset } = await import("@/lib/pi/computer-use");
    resetComputerUseRuntimeForHardReset();
  }, warnings);
  await attempt("computer-use state", async () => {
    const { StateTracker } = await import("@/lib/computer-use/state");
    StateTracker.resetForHardReset();
  }, warnings);
  await attempt("CUA Driver mirror", async () => {
    const { resetCuaRuntimeForHardReset } = await import("@/lib/cua/events");
    const { resetCuaDaemonReady } = await import("@/lib/cua/driver");
    resetCuaRuntimeForHardReset();
    resetCuaDaemonReady();
  }, warnings);
  await attempt("pending permissions", async () => {
    const { clearPendingPermissionsForHardReset } = await import("@/lib/middleware/permission-middleware");
    clearPendingPermissionsForHardReset();
  }, warnings);
  await attempt("pending questions", async () => {
    const { clearPendingQuestionsForHardReset } = await import("@/lib/agent/tools/ask-user-tool");
    clearPendingQuestionsForHardReset();
  }, warnings);
}

async function clearSerializedState(errors: string[]): Promise<void> {
  await attempt("announcement ledger", clearAnnouncementsForHardReset, errors);
  await attempt("heartbeat work ledger", clearHeartbeatWorkForHardReset, errors);
}

async function removeStatePath(path: string, removed: string[], errors: string[]): Promise<void> {
  if (!existsSync(path)) return;
  let lastError: unknown;
  for (let attemptNo = 0; attemptNo < 4; attemptNo++) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
      if (!existsSync(path)) {
        removed.push(path);
        return;
      }
      lastError = new Error("path still exists after removal");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 75 * (attemptNo + 1)));
  }
  errors.push(`Could not remove ${basename(path)}: ${messageOf(lastError)}`);
}

async function runHardReset(): Promise<HardResetResult> {
  const dataDir = getDataDir();
  const errors: string[] = [];
  const warnings: string[] = [];
  const removed: string[] = [];
  let pause: Awaited<ReturnType<typeof pauseSchedulerForHardReset>> | null = null;

  try {
    pause = await pauseSchedulerForHardReset();
    await abortBackgroundWork(warnings);
    const idle = await pause.waitForIdle();
    if (!idle) warnings.push("background work did not stop within 5s; its writes were invalidated");

    await clearRuntimeCaches(warnings);
    await clearSerializedState(errors);
    resetTasksForHardReset();

    for (const path of hardResetPaths(dataDir)) {
      await removeStatePath(path, removed, errors);
    }

    // Reinstall a fresh cache after deleting the directory. A resumed tick
    // must never flush the old task array back into scheduled-tasks.json.
    resetTasksForHardReset();
  } catch (error) {
    errors.push(`hard reset failed: ${messageOf(error)}`);
  } finally {
    if (pause) await attempt("scheduler resume", pause.resume, errors);
  }

  return {
    ok: errors.length === 0,
    dataDir,
    removed,
    errors,
    warnings,
  };
}

/** Serialize concurrent hard resets across Next.js route bundles. */
export function performHardReset(): Promise<HardResetResult> {
  const state = hardResetGlobal();
  if (!state.promise) {
    state.promise = runHardReset().finally(() => {
      state.promise = undefined;
    });
  }
  return state.promise;
}
