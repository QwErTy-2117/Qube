import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_USER_ID = "qube-default-user";

let composioClient: any = null;

function loadApiKey(): string {
  if (process.env.COMPOSIO_API_KEY) return process.env.COMPOSIO_API_KEY;
  try {
    const configPath = join(process.cwd(), "env.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.COMPOSIO_API_KEY) return config.COMPOSIO_API_KEY;
    }
  } catch {}
  throw new Error("COMPOSIO_API_KEY not found — set it in .env or rebuild");
}

export function getClient(): any {
  if (!composioClient) {
    composioClient = new Composio({ apiKey: loadApiKey(), provider: new VercelProvider() });
  }
  return composioClient;
}

export interface ConnectorDisplay {
  id: string;
  name: string;
  description: string;
  brandColor: string;
  icon: string;
  hasIcon: boolean;
  appUrl: string;
  connected: boolean;
}

const KNOWN_ICON_IDS = new Set([
  "linear","atlassian","trello","airtable","notion",
  "slack","github","google","hubspot","asana","dropbox",
]);

const KNOWN_COLORS: Record<string, string> = {
  linear: "#5E6AD2",
  atlassian: "#0052CC",
  trello: "#0052CC",
  airtable: "#FFBF00",
  notion: "currentColor",
  slack: "#4A154B",
  github: "currentColor",
  google: "#4285F4",
  hubspot: "#FF7A59",
  asana: "#F06A6A",
  dropbox: "#0061FF",
};

export async function listConnectors(userId?: string): Promise<ConnectorDisplay[]> {
  try {
    const client = getClient();

    const [authConfigs, connectedAccounts] = await Promise.all([
      client.authConfigs.list({}),
      userId
        ? client.connectedAccounts.list({ userIds: [userId] }).catch(() => ({ items: [] }))
        : Promise.resolve({ items: [] }),
    ]);

    const connectedSlugs = new Set<string>();
    for (const acct of connectedAccounts.items || []) {
      const slug = acct.toolkit?.slug || acct.app?.toLowerCase();
      if (slug) connectedSlugs.add(slug);
    }

    const toolkitSlugs = new Set<string>();
    for (const ac of authConfigs.items || []) {
      const slug = ac.toolkit?.slug || ac.app?.toLowerCase();
      if (slug) toolkitSlugs.add(slug);
    }

    if (toolkitSlugs.size === 0) return [];

    const allToolkits: any[] = await client.toolkits.get({});
    const tkMap = new Map<string, any>();
    for (const tk of allToolkits) {
      tkMap.set(tk.slug, tk);
    }

    const result: ConnectorDisplay[] = [];

    for (const slug of toolkitSlugs) {
      const tk = tkMap.get(slug);
      const name = tk?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
      const meta = tk?.meta ?? {};
      const desc = meta?.description ?? `${name} integration`;
      const logo = meta?.logo ?? "";

      if (KNOWN_ICON_IDS.has(slug)) {
        result.push({
          id: slug,
          name,
          description: desc,
          brandColor: KNOWN_COLORS[slug]!,
          icon: slug,
          hasIcon: true,
          appUrl: meta?.appUrl ?? "",
          connected: connectedSlugs.has(slug),
        });
      } else {
        result.push({
          id: slug,
          name,
          description: desc,
          brandColor: logo ? "#888" : "#aaa",
          icon: logo || "default",
          hasIcon: !!logo,
          appUrl: meta?.appUrl ?? "",
          connected: connectedSlugs.has(slug),
        });
      }
    }

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  } catch (e) {
    console.error("[composio] failed to list toolkits:", e);
    return [];
  }
}

export async function initiateConnection(connectorId: string, userId: string, callbackUrl?: string): Promise<string | null> {
  try {
    const client = getClient();
    const options = callbackUrl ? { callbackUrl } : undefined;
    const authConfigs = await client.authConfigs.list({ toolkit: connectorId });
    if (!authConfigs.items?.length) {
      const allConfigs = await client.authConfigs.list({});
      const match = allConfigs.items?.find((a: any) =>
        a.toolkit?.slug === connectorId || a.app?.toLowerCase() === connectorId
      );
      if (!match) return null;
      const req = await client.connectedAccounts.link(userId, match.id, options);
      return req.redirectUrl ?? null;
    }
    const req = await client.connectedAccounts.link(userId, authConfigs.items[0].id, options);
    return req.redirectUrl ?? null;
  } catch (e) {
    console.error(`[composio] initiateConnection failed for ${connectorId}:`, e);
    return null;
  }
}

export async function getConnectedToolkits(userId: string): Promise<string[]> {
  try {
    const client = getClient();
    const accounts = await client.connectedAccounts.list({ userIds: [userId] });
    const slugs = new Set<string>();
    for (const acct of accounts.items || []) {
      const slug = acct.toolkit?.slug || acct.app?.toLowerCase();
      if (slug) slugs.add(slug);
    }
    return Array.from(slugs);
  } catch {
    return [];
  }
}

export const COMPOSIO_TOOLKIT_MAP: Record<string, string[]> = {
  linear: ["linear"],
  atlassian: ["jira"],
  trello: ["trello"],
  airtable: ["airtable"],
  notion: ["notion"],
  slack: ["slack"],
  github: ["github"],
  google: ["gmail", "googlecalendar", "googledrive"],
  hubspot: ["hubspot"],
  asana: ["asana"],
  dropbox: ["dropbox"],
};

export function getToolkitSlugs(connectorId: string): string[] {
  return COMPOSIO_TOOLKIT_MAP[connectorId] || [];
}

export async function getSessionForUser(userId: string) {
  const client = getClient();
  const toolkits = Object.values(COMPOSIO_TOOLKIT_MAP).flat();
  const session = await client.sessions.create(userId, {
    toolkits,
    manageConnections: true,
  });
  return session;
}

export async function getConnectorTools(userId?: string) {
  const client = getClient();
  const uid = userId || DEFAULT_USER_ID;
  const toolkits = Object.values(COMPOSIO_TOOLKIT_MAP).flat();
  const session = await client.sessions.create(uid, {
    toolkits,
    manageConnections: true,
  });
  const tools: Record<string, any> = await session.tools();

  for (const [_name, tool] of Object.entries(tools)) {
    if (tool.parameters?.extend) {
      try {
        tool.parameters = tool.parameters.extend({
          label: z.string().optional().describe("Short friendly label — say what you're doing in plain language"),
        });
      } catch {}
    }
    if (tool.parameterSchema && typeof tool.parameterSchema === "object") {
      try {
        tool.parameterSchema = {
          ...tool.parameterSchema,
          properties: {
            ...(tool.parameterSchema.properties || {}),
            label: { type: "string", description: "Short friendly label — say what you're doing in plain language" },
          },
        };
      } catch {}
    }
  }

  return tools;
}
