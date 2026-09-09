/**
 * Task executor — now delegates to Pi harness (lib/pi/task-runner).
 * This file is the canonical entry for scheduler; it no longer owns its own
 * model client / tool creation. Pi is the authoritative agent runtime.
 */

import type { ScheduledTask } from "./types";
import { executePiTask, cancelPiTask, isPiTaskActive } from "@/lib/pi/task-runner";

export async function executeTask(
  task: ScheduledTask
): Promise<{ status: "success" | "error"; output: string; duration: number }> {
  // Pi-owned execution: handles lifecycle, timeout, cancellation, cleanup
  return executePiTask(task);
}

// Control-plane passthrough for callers that need task-level cancellation
export { cancelPiTask as cancelTask, isPiTaskActive as isTaskActive };
