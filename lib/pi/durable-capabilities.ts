import type { RegistrySnapshot } from "@earendil-works/pi-durable";
import { buildVercelExtension, type VercelTool } from "@/lib/pi/durable-tools";

export type CapabilityLoader = () => Promise<{
  tools: Record<string, VercelTool>;
  cleanup?: () => Promise<void>;
}>;

export type TurnCapabilities = {
  /** Loads Composio connector tools for the user's connected toolkits. */
  connectors?: CapabilityLoader;
  /** Loads custom MCP server tools (client lifecycle owned by the loader). */
  mcp?: CapabilityLoader;
};

export type InstalledCapabilities = {
  /** Extension names installed this turn. */
  installed: string[];
  /** Non-fatal load failures, for logging/UI. */
  errors: Array<{ source: string; error: string }>;
  /** Close resources (MCP clients) and detach nothing else. */
  cleanup: () => Promise<void>;
};

/**
 * Install per-turn capability extensions (connectors, MCP) into the
 * durable registry. Loading is isolated: one failing source never
 * breaks the turn. Re-installing the same extension name replaces it
 * in one step, so repeat turns are safe.
 */
export async function installTurnCapabilities(
  registry: { install: (ext: unknown) => void; snapshot?: () => RegistrySnapshot },
  loaders: TurnCapabilities,
): Promise<InstalledCapabilities> {
  const installed: string[] = [];
  const errors: Array<{ source: string; error: string }> = [];
  const cleanups: Array<() => Promise<void>> = [];

  const sources: Array<{ name: string; loader?: CapabilityLoader; extName: string }> = [
    { name: "mcp", loader: loaders.mcp, extName: "mcp-turn" },
    { name: "connectors", loader: loaders.connectors, extName: "connectors" },
  ];

  for (const source of sources) {
    if (!source.loader) continue;
    try {
      const { tools, cleanup } = await source.loader();
      if (cleanup) cleanups.push(cleanup);
      if (tools && Object.keys(tools).length > 0) {
        registry.install(buildVercelExtension(source.extName, tools));
        installed.push(source.extName);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ source: source.name, error: msg.slice(0, 300) });
    }
  }

  return {
    installed,
    errors,
    cleanup: async () => {
      for (const c of cleanups) {
        try {
          await c();
        } catch {
          // Cleanup must never throw into the turn.
        }
      }
    },
  };
}

/** Default loaders backed by Qube's real MCP + connector subsystems. */
export function defaultCapabilityLoaders(threadId: string, instanceId?: string): TurnCapabilities {
  return {
    connectors: async () => {
      const { loadConnectorTools } = await import("@/lib/pi/connectors");
      const { tools } = await loadConnectorTools(instanceId);
      return { tools };
    },
    mcp: async () => {
      const { loadMcpTools, closeMcpClients } = await import("@/lib/pi/mcp");
      const { tools, clients } = await loadMcpTools({ threadId });
      // The durable guard hook only covers delete_file / run_command /
      // computer_* / connectors — MCP tools (including the built-in browser
      // surface) would otherwise run with no repeat-guard, no risk gating,
      // no verification, and no audit log. Wrap them in the same kernel
      // pipeline as every other path (headless: risky actions are denied).
      // Connectors are deliberately excluded: the guard owns them, and a
      // repeat-block on a retried send could break legitimate flows.
      try {
        const { applyKernel, kernelEnabled } = await import("@/lib/computer-use/index");
        if (kernelEnabled()) applyKernel(tools as Record<string, any>, { threadId, interactive: false });
      } catch {}
      return { tools, cleanup: () => closeMcpClients(clients) };
    },
  };
}
