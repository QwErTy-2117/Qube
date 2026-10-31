/**
 * Qube Computer tools for the durable (snapshot/replay) agent path.
 *
 * Reuses the exact same tool implementations as the harness instead of a
 * second copy of the runtime, so both agent paths behave identically.
 */

import { buildVercelExtension } from "@/lib/pi/durable-tools";
import { createComputerTools } from "@/lib/computer/tools";

export function buildComputerExtension() {
  return buildVercelExtension("computer", createComputerTools());
}
