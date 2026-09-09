/**
 * @deprecated Codex harness is REMOVED from production execution path.
 * Pi harness (lib/pi/harness.ts) is now the authoritative backend.
 *
 * This shim remains for backward compatibility only and forwards all calls to Pi.
 * It will be deleted after migration stabilizes. Do NOT add new callers here.
 */

import { runPiHarness } from "@/lib/pi/harness";
import type { PiConfig } from "@/lib/pi/harness";

export type CodexConfig = PiConfig;

// Deprecated: route should import runPiHarness from "@/lib/pi/harness" directly
export async function runCodexHarness(writer: any, config: CodexConfig): Promise<void> {
  console.warn("[codex-harness] DEPRECATED shim invoked — forwarding to Pi harness (please migrate caller to lib/pi/harness)");
  return runPiHarness(writer, config);
}

export async function createCodexAgent(config: CodexConfig) {
  console.warn("[codex-harness] createCodexAgent DEPRECATED — use Pi harness");
  return {
    toUIMessageStream: () => {
      throw new Error("createCodexAgent is deprecated. Use runPiHarness(writer, config) from lib/pi/harness.");
    },
    _config: config,
  } as any;
}
