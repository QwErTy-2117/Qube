import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { composioKeyStore } from "./composio-key-store";

const DESTRUCTIVE_KEYWORDS = [
  "send", "create", "post", "delete", "remove",
  "update", "edit", "modify", "upload", "transfer",
];

function isDestructiveTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some(kw => lower.includes(kw));
}

const pendingConfirmations = new Map<string, {
  resolve: () => void;
  reject: (reason: string) => void;
  toolName: string;
  args: any;
}>();

export function getPendingConfirmations(threadId: string): Array<{
  confirmationId: string;
  toolName: string;
  args: any;
}> {
  const result: Array<any> = [];
  for (const [key, val] of pendingConfirmations) {
    if (key.startsWith(threadId)) {
      result.push({
        confirmationId: key,
        toolName: val.toolName,
        args: val.args,
      });
    }
  }
  return result;
}

export function resolveConfirmation(confirmationId: string, action: "confirm" | "cancel"): boolean {
  const pending = pendingConfirmations.get(confirmationId);
  if (!pending) return false;
  if (action === "confirm") {
    pending.resolve();
  } else {
    pending.reject("User cancelled this action");
  }
  pendingConfirmations.delete(confirmationId);
  return true;
}

export const DEFAULT_USER_ID = "qube-default-user";

let composioClient: any = null;

export function resetComposioClient() {
  composioClient = null;
}

/** True when a built-in key exists (release builds embed one via env.json). Never returns the key itself. */
export function hasBuiltInKey(): boolean {
  if (process.env.COMPOSIO_API_KEY) return true;
  try {
    const configPath = join(process.cwd(), "env.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.COMPOSIO_API_KEY) return true;
    }
  } catch {}
  return false;
}

function loadApiKey(): string {
  // User override from Settings → Advanced → Composio API Key (custom mode).
  try {
    const custom = composioKeyStore.getActiveCustomKey();
    if (custom) return custom;
  } catch {}
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

// Static metadata for the curated connectors — lets listConnectors return
// instantly without waiting on the slow toolkits.get({}) catalog fetch.
// Descriptions mirror the Composio catalog; appUrl is the vendor homepage.
const STATIC_CONNECTOR_META: Record<string, { name: string; description: string; appUrl: string }> = {
  linear: { name: "Linear", description: "Issue tracking and project management for software teams.", appUrl: "https://linear.app" },
  atlassian: { name: "Jira", description: "Track issues, plan sprints, and manage agile projects.", appUrl: "https://www.atlassian.com/software/jira" },
  trello: { name: "Trello", description: "Boards, lists, and cards to organize projects visually.", appUrl: "https://trello.com" },
  airtable: { name: "Airtable", description: "Spreadsheet-database hybrid for organizing anything.", appUrl: "https://airtable.com" },
  notion: { name: "Notion", description: "Docs, wikis, and project tracking in one workspace.", appUrl: "https://notion.so" },
  slack: { name: "Slack", description: "Team messaging, channels, and notifications.", appUrl: "https://slack.com" },
  github: { name: "GitHub", description: "Code hosting, pull requests, and issues.", appUrl: "https://github.com" },
  google: { name: "Google", description: "Gmail, Calendar, and Drive in one connection.", appUrl: "https://workspace.google.com" },
  hubspot: { name: "HubSpot", description: "CRM, marketing, and sales pipelines.", appUrl: "https://hubspot.com" },
  asana: { name: "Asana", description: "Task management and team project tracking.", appUrl: "https://asana.com" },
  dropbox: { name: "Dropbox", description: "Cloud file storage and sharing.", appUrl: "https://dropbox.com" },
  canva: { name: "Canva", description: "Design graphics, slides, and social posts.", appUrl: "https://canva.com" },
};

// --- Caches: toolkit catalog (slow, rarely changes) + per-user list (connected flags change) ---
let toolkitMetaCache: { map: Map<string, any>; expires: number } | null = null;
const TOOLKIT_META_TTL_MS = 10 * 60 * 1000;
const listCache = new Map<string, { data: ConnectorDisplay[]; expires: number }>();
const LIST_TTL_MS = 20 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); });
  });
}

export function invalidateConnectorListCache(userId?: string) {
  if (userId) listCache.delete(userId);
  else listCache.clear();
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
  canva: ["canva"],
};

export async function listConnectors(userId?: string, opts?: { bypassCache?: boolean }): Promise<ConnectorDisplay[]> {
  const uid = userId || DEFAULT_USER_ID;
  const now = Date.now();

  // Serve stale-while-revalidate from server cache — settings/onboarding
  // remount on every open, and the catalog fetch below is the slow part.
  const cached = listCache.get(uid);
  if (!opts?.bypassCache && cached && cached.expires > now) return cached.data;

  const buildFromSlugs = (
    slugs: Set<string>,
    connectedSlugs: Set<string>,
    tkMap: Map<string, any>,
  ): ConnectorDisplay[] => {
    const isConnected = (slug: string): boolean => {
      const toolkits = COMPOSIO_TOOLKIT_MAP[slug] || [slug];
      return toolkits.some((t) => connectedSlugs.has(t));
    };
    const result: ConnectorDisplay[] = [];
    for (const slug of slugs) {
      const staticMeta = STATIC_CONNECTOR_META[slug];
      const tk = tkMap.get(slug);
      const meta = tk?.meta ?? {};
      const name = staticMeta?.name ?? tk?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
      const desc = staticMeta?.description ?? meta?.description ?? `${name} integration`;
      const logo = meta?.logo ?? "";
      const appUrl = staticMeta?.appUrl ?? meta?.appUrl ?? "";
      if (KNOWN_ICON_IDS.has(slug)) {
        result.push({
          id: slug,
          name,
          description: desc,
          brandColor: KNOWN_COLORS[slug]!,
          icon: slug,
          hasIcon: true,
          appUrl,
          connected: isConnected(slug),
        });
      } else {
        result.push({
          id: slug,
          name,
          description: desc,
          brandColor: logo ? "#888" : "#aaa",
          icon: logo || "default",
          hasIcon: !!logo,
          appUrl,
          connected: isConnected(slug),
        });
      }
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  };

  try {
    const client = getClient();

    // Parallel live calls with a hard cap — a hung Composio endpoint must
    // never hold the settings spinner for the full 10s client timeout.
    let authConfigs: any = { items: [] };
    let connectedAccounts: any = { items: [] };
    try {
      [authConfigs, connectedAccounts] = await withTimeout(
        Promise.all([
          client.authConfigs.list({ limit: 100 }),
          client.connectedAccounts.list({ userIds: [uid], limit: 100 }).catch(() => ({ items: [] })),
        ]),
        6000,
      );
    } catch (e) {
      console.warn("[composio] list live fetch slow/failed, using fallback:", (e as Error)?.message || e);
      // Fallback: serve cached (even stale) or the static curated list with
      // unknown connected state instead of an empty spinner.
      if (cached) return cached.data;
      const fallback = buildFromSlugs(new Set(Object.keys(STATIC_CONNECTOR_META)), new Set(), new Map());
      listCache.set(uid, { data: fallback, expires: now + 5000 });
      return fallback;
    }

    const connectedSlugs = new Set<string>();
    for (const acct of connectedAccounts.items || []) {
      if (acct.status !== "ACTIVE") continue;
      const slug = acct.toolkit?.slug || acct.app?.toLowerCase();
      if (slug) connectedSlugs.add(slug);
    }

    const toolkitSlugs = new Set<string>();
    for (const ac of authConfigs.items || []) {
      const slug = ac.toolkit?.slug || ac.app?.toLowerCase();
      if (slug) toolkitSlugs.add(slug);
    }
    // Nothing configured server-side yet — still show the curated list so
    // the tab opens instantly with connectable tiles.
    if (toolkitSlugs.size === 0) {
      for (const k of Object.keys(STATIC_CONNECTOR_META)) toolkitSlugs.add(k);
    }

    // Toolkit catalog: cached aggressively; only fetched when there are
    // slugs we don't already know statically, and never blocks longer
    // than ~2.5s (static meta covers all curated connectors anyway).
    let tkMap = toolkitMetaCache && toolkitMetaCache.expires > now
      ? toolkitMetaCache.map
      : new Map<string, any>();
    const unknownSlugs = [...toolkitSlugs].filter((s) => !STATIC_CONNECTOR_META[s] && !tkMap.has(s));
    if (unknownSlugs.length > 0) {
      try {
        const allToolkits: any[] = await withTimeout(client.toolkits.get({}), 2500);
        const fresh = new Map<string, any>();
        for (const tk of allToolkits || []) {
          if (tk?.slug) fresh.set(tk.slug, tk);
        }
        if (fresh.size > 0) {
          tkMap = fresh;
          toolkitMetaCache = { map: fresh, expires: now + TOOLKIT_META_TTL_MS };
        }
      } catch {
        // Non-fatal: unknown slugs fall back to capitalized names below.
      }
    }

    const result = buildFromSlugs(toolkitSlugs, connectedSlugs, tkMap);
    listCache.set(uid, { data: result, expires: now + LIST_TTL_MS });
    return result;
  } catch (e) {
    console.error("[composio] failed to list toolkits:", e);
    if (cached) return cached.data;
    return [];
  }
}

export async function initiateConnection(connectorId: string, userId: string, callbackUrl?: string): Promise<string | null> {
  try {
    const client = getClient();
    const options = callbackUrl ? { callbackUrl } : undefined;

    const toolkits = COMPOSIO_TOOLKIT_MAP[connectorId] || [connectorId];

    for (const toolkit of toolkits) {
      const authConfigs = await client.authConfigs.list({ toolkit });
      if (authConfigs.items?.length) {
        const req = await client.connectedAccounts.link(userId, authConfigs.items[0].id, options);
        return req.redirectUrl ?? null;
      }
    }

    const allConfigs = await client.authConfigs.list({ limit: 100 });
    const toolkitsSet = new Set(toolkits);
    const match = allConfigs.items?.find((a: any) =>
      toolkitsSet.has(a.toolkit?.slug) || toolkitsSet.has(a.app?.toLowerCase())
    );
    if (!match) return null;
    const req = await client.connectedAccounts.link(userId, match.id, options);
    return req.redirectUrl ?? null;
  } catch (e) {
    console.error(`[composio] initiateConnection failed for ${connectorId}:`, e);
    return null;
  }
}

export async function getConnectedToolkits(userId: string, connectorId?: string): Promise<string[]> {
  try {
    const client = getClient();
    const accounts = await client.connectedAccounts.list({ userIds: [userId], limit: 100 }).catch(() => ({ items: [] }));
    const slugs = new Set<string>();
    for (const acct of accounts.items || []) {
      const slug = acct.toolkit?.slug || acct.app?.toLowerCase();
      if (slug) slugs.add(slug);
    }

    if (connectorId) {
      const toolkits = COMPOSIO_TOOLKIT_MAP[connectorId] || [connectorId];
      return toolkits.filter((s) => slugs.has(s));
    }

    return Array.from(slugs);
  } catch {
    return [];
  }
}

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
  const allTools: Record<string, any> = {};

  const connectedSlugs = await getConnectedToolkits(uid);

  const connectorIds = Object.keys(COMPOSIO_TOOLKIT_MAP);
  await Promise.all(
    connectorIds.map(async (cid) => {
      const toolkits = COMPOSIO_TOOLKIT_MAP[cid];
      const hasConnection = toolkits.some((slug) => connectedSlugs.includes(slug));
      if (!hasConnection) return;
      try {
        const session = await client.sessions.create(uid, {
          toolkits,
          manageConnections: true,
        });
        const tools = await session.tools();
        Object.assign(allTools, tools);
      } catch (e) {
        console.error(`[composio] failed to get tools for connector ${cid}:`, e);
      }
    })
  );

  const tools = allTools;

  for (const [_name, tool] of Object.entries(tools)) {
    if (tool.parameters?.extend) {
      try {
        tool.parameters = tool.parameters.extend({
          label: z.string().optional().describe("Fun, playful label for the UI (e.g. 'Slacking off', 'Dabbling in spreadsheets'). Keep it light. Never mention 'composio'."),
        });
      } catch {}
    }
    if (tool.parameterSchema && typeof tool.parameterSchema === "object") {
      try {
        tool.parameterSchema = {
          ...tool.parameterSchema,
          properties: {
            ...(tool.parameterSchema.properties || {}),
            label: { type: "string", description: "Fun, playful label for the UI (e.g. 'Slacking off', 'Dabbling in spreadsheets'). Keep it light. Never mention 'composio'." },
          },
        };
      } catch {}
    }
  }

  for (const [name, tool] of Object.entries(tools)) {
    if (isDestructiveTool(name) && tool.execute) {
      const originalExecute = tool.execute.bind(tool);
      tool.execute = async (args: any, extra?: any) => {
        const threadId = extra?.threadId || args?.threadId || "default";
        return new Promise<string>((resolve, reject) => {
          const confirmationId = `composio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          pendingConfirmations.set(confirmationId, {
            resolve: () => {
              originalExecute(args, extra).then(resolve).catch(reject);
            },
            reject,
            toolName: name,
            args,
          });
          setTimeout(() => {
            if (pendingConfirmations.has(confirmationId)) {
              pendingConfirmations.delete(confirmationId);
              reject("Confirmation timed out");
            }
          }, 300_000);
        });
      };
    }
  }

  return tools;
}
