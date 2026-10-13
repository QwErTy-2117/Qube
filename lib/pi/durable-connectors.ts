import {
  buildVercelExtension,
  convertVercelTool,
  vercelInputSchema,
  type VercelTool,
} from "@/lib/pi/durable-tools";

export type ConnectorTool = VercelTool;

/** Back-compat alias: connector input schema → JSON Schema. */
export function connectorJsonSchema(schema: unknown): Record<string, unknown> {
  return vercelInputSchema({ inputSchema: schema, execute: async () => undefined });
}

/**
 * Convert one Composio connector tool to a durable tool. Read-only
 * lookups stay free; sends/creates/deletes are gated by the guard
 * extension's sensitivity classifier. No replay: remote side effects.
 */
export function convertConnectorTool(name: string, tool: ConnectorTool) {
  return convertVercelTool(name, tool);
}

export function buildConnectorsExtension(tools: Record<string, ConnectorTool>) {
  return buildVercelExtension("connectors", tools);
}
