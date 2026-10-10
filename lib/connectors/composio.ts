import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/lib/data-dir";
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

/**
 * Resolve the Composio user id for a caller, NEVER falling back to the
 * shared global default.
 *
 * Why: production builds embed ONE built-in COMPOSIO_API_KEY for every user
 * worldwide, so per-user isolation depends entirely on distinct userIds.
 * Fresh installs used to query as "qube-default-user" (empty localStorage
 * before the UUID effect ran), so any account ever connected under that
 * namespace made EVERY fresh install show connectors as connected — and the
 * agent would even load someone else's tools. The literal default namespace
 * is now abandoned.
 *
 * Second half of the story (scheduled tasks couldn't see Gmail): connections
 * are linked under the CLIENT's per-install UUID, but background runs have
 * no client and used to resolve to a different server device id — so the
 * scheduler saw zero connected toolkits while chat saw them fine. Fix: the
 * first real client UUID the server sees is remembered as the CANONICAL id
 * (server data dir) and reused whenever the caller passes nothing (i.e.
 * every background run). Single-user desktop assumption: if a different
 * client UUID ever shows up, last-writer-wins. Different machines never
 * collide (separate data dirs).
 */
let canonicalCache: string | null | undefined;

function canonicalFile(): string {
  return join(getDataDir(), ".memory", "composio-user-id");
}

function readCanonicalId(): string | null {
  if (canonicalCache !== undefined) return canonicalCache;
  try {
    if (existsSync(canonicalFile())) {
      const saved = readFileSync(canonicalFile(), "utf-8").trim();
      if (saved && saved !== DEFAULT_USER_ID) {
        canonicalCache = saved;
        return saved;
      }
    }
  } catch {}
  canonicalCache = null;
  return null;
}

function writeCanonicalId(id: string): void {
  canonicalCache = id;
  try {
    const dir = join(getDataDir(), ".memory");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(canonicalFile(), id, "utf-8");
  } catch {}
}

export function resolveComposioUserId(input?: string | null): string {
  const t = (input || "").trim();
  // A real client UUID is authoritative: remember it as canonical so
  // background scheduler runs (which pass nothing) use the SAME namespace
  // the user actually connected their accounts under.
  if (t && t !== DEFAULT_USER_ID) {
    if (readCanonicalId() !== t) writeCanonicalId(t);
    return t;
  }
  // Background / missing-id callers: canonical client id first, else a
  // persistent per-device id (stable across restarts, unique per machine).
  const canonical = readCanonicalId();
  if (canonical) return canonical;
  // Static imports — no lazy require (require is undefined in ESM
  // test/prod contexts and must never be load-bearing).
  try {
    const file = join(getDataDir(), ".memory", "device-id");
    try {
      if (existsSync(file)) {
        const saved = readFileSync(file, "utf-8").trim();
        if (saved && saved !== DEFAULT_USER_ID) return saved;
      }
    } catch {}
    const fresh =
      typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
        ? (crypto as any).randomUUID()
        : `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const dir = join(getDataDir(), ".memory");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, fresh, "utf-8");
    } catch {}
    return fresh;
  } catch {
    return `fallback_${Date.now().toString(36)}`;
  }
}

/** Test hook: reset the in-memory canonical cache (data-dir files remain). */
export function __resetCanonicalCacheForTests(): void {
  canonicalCache = undefined;
}

let composioClient: any = null;

export function resetComposioClient() {
  composioClient = null;
  // The list cache is keyed per user id, but entries were fetched with a
  // specific API key — switching builtin<->custom must not serve the other
  // key's connected flags as truth.
  try {
    listCache.clear();
  } catch {}
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
  /**
   * Per-toolkit Composio logo URLs (Composio logo CDN) for connectors that
   * bundle several apps — e.g. google → { gmail, googlecalendar,
   * googledrive }. Lets tool cards show each app's own colored logo instead
   * of the parent connector mark.
   */
  toolkitLogos?: Record<string, string>;
}

import { composioLogoUrl } from "./composio-logo";

/** Re-exported for back-compat (now lives in client-safe `./composio-logo`). */
export { composioLogoUrl } from "./composio-logo";

const KNOWN_ICON_IDS = new Set([
  "linear","atlassian","trello","airtable","notion",
  "slack","github","google","hubspot","asana","dropbox",
  "canva",
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
  canva: "#00C4CC",
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
  const uid = resolveComposioUserId(userId);
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
        // Primary artwork is always the Composio logo CDN (most up-to-date
        // vendor mark). `google` is our own bundle (Gmail + Calendar + Drive)
        // with no single Composio logo (`/api/google` is a fallback grid),
        // so it keeps the static "G" id and the frontend renders the current
        // Google mark; its per-app `toolkitLogos` below still carry the live
        // Gmail / Calendar / Drive artwork.
        const toolkits = COMPOSIO_TOOLKIT_MAP[slug] || [slug];
        const firstToolkit = toolkits[0] || slug;
        const logoUrl = slug === "google"
          ? slug
          : tkMap.get(firstToolkit)?.meta?.logo
            || tkMap.get(slug)?.meta?.logo
            || composioLogoUrl(firstToolkit);
        result.push({
          id: slug,
          name,
          description: desc,
          brandColor: KNOWN_COLORS[slug]!,
          icon: logoUrl,
          hasIcon: true,
          appUrl,
          connected: isConnected(slug),
          toolkitLogos: Object.fromEntries(
            toolkits.map((t) => [
              t,
              tkMap.get(t)?.meta?.logo || composioLogoUrl(t),
            ]),
          ),
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
    // NOTE: connectedAccounts success is tracked separately. When the live
    // connected check fails (offline/slow/proxy), we must show DISCONNECTED
    // rather than serving a stale cached connected:true — a false green
    // badge is worse than a spinner (it was reported on Windows prod).
    let authConfigs: any = { items: [] };
    let connectedAccounts: any = { items: [] };
    let liveConnectedOk = false;
    try {
      const live = await withTimeout(
        Promise.all([
          client.authConfigs.list({ limit: 100 }),
          client.connectedAccounts.list({ userIds: [uid], limit: 100 }).catch(() => ({ items: [], __failed: true })),
        ]),
        6000,
      );
      authConfigs = live[0] || { items: [] };
      connectedAccounts = live[1] || { items: [] };
      liveConnectedOk = !(connectedAccounts as any).__failed;
    } catch (e) {
      console.warn("[composio] list live fetch slow/failed, using fallback:", (e as Error)?.message || e);
      // Fallback: never claim connected without a live check. Serve the
      // curated list as all-disconnected (short TTL) instead of stale cache.
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
    // If the live connected check failed but authConfigs succeeded, the
    // connected flags are unverified — force disconnected (safe default).
    const safe = liveConnectedOk
      ? result
      : result.map((c) => ({ ...c, connected: false }));
    listCache.set(uid, { data: safe, expires: now + (liveConnectedOk ? LIST_TTL_MS : 5000) });
    return safe;
  } catch (e) {
    console.error("[composio] failed to list toolkits:", e);
    // Never serve a stale connected:true as truth after a hard failure.
    if (cached) return cached.data.map((c) => ({ ...c, connected: false }));
    return [];
  }
}

export async function initiateConnection(connectorId: string, userId: string, callbackUrl?: string): Promise<string | null> {
  try {
    const uid = resolveComposioUserId(userId);
    const client = getClient();
    const options = callbackUrl ? { callbackUrl } : undefined;

    const toolkits = COMPOSIO_TOOLKIT_MAP[connectorId] || [connectorId];

    for (const toolkit of toolkits) {
      const authConfigs = await client.authConfigs.list({ toolkit });
      if (authConfigs.items?.length) {
        const req = await client.connectedAccounts.link(uid, authConfigs.items[0].id, options);
        return req.redirectUrl ?? null;
      }
    }

    const allConfigs = await client.authConfigs.list({ limit: 100 });
    const toolkitsSet = new Set(toolkits);
    const match = allConfigs.items?.find((a: any) =>
      toolkitsSet.has(a.toolkit?.slug) || toolkitsSet.has(a.app?.toLowerCase())
    );
    if (!match) return null;
    const req = await client.connectedAccounts.link(uid, match.id, options);
    return req.redirectUrl ?? null;
  } catch (e) {
    console.error(`[composio] initiateConnection failed for ${connectorId}:`, e);
    return null;
  }
}

export async function getConnectedToolkits(userId: string, connectorId?: string): Promise<string[]> {
  try {
    const uid = resolveComposioUserId(userId);
    const client = getClient();
    const accounts = await client.connectedAccounts.list({ userIds: [uid], limit: 100 }).catch(() => ({ items: [] }));
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
  const uid = resolveComposioUserId(userId ?? null);
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

  // NOTE (Muse Sentinel parity): destructive connector gating no longer
  // lives here. getConnectorTools returns RAW tools; the Pi harness wraps
  // sensitive ones with withPermissionCheck (unified permission store), so
  // the chat blocks on the PermissionBar widget (allow once / always / deny)
  // with a user-visible purpose. Headless heartbeat runs get draft-only
  // stubs instead (see task-runner); user-created scheduled tasks run their
  // instructed sends for real.
  // The legacy pendingConfirmations map below is kept for back-compat with
  // /api/connectors/pending callers (now always empty for new runs).

  return tools;
}
