/**
 * Single source of truth for connector (Composio app) metadata used by the
 * chat UI.
 *
 * Flow (per request):
 * - The agent emits a tool call (e.g. `github_create_issue`, `gmail_send_email`,
 *   or a `composio_*` meta-tool). The backend (Pi harness) already merged the
 *   raw Composio session tools, so the tool name is the only routing signal.
 * - The frontend intercepts the tool name, maps it to an app via
 *   `getConnectorMetaForTool`, grabs the app logo from the cached Composio app
 *   metadata (`/api/connectors/list` → `connectors-cache`, which carries the
 *   Composio Apps API display name / description / logo URL), and renders a
 *   custom card with a pre-made playful name + logo — never the raw tool id
 *   and never a serious "Agent is using X..." string.
 *
 * Style: playful plain language, same voice as `tool-labels.ts`
 * (e.g. "Slacking off", "Poking the repo"). Raw snake_case ids and jargon
 * (composio/mcp/snapshot/cdp/...) never leak.
 */

export interface ConnectorMeta {
  /** Connector id for cache/icon lookup (e.g. "google", "github", "atlassian"). */
  displayId: string;
  /** Icon id for `renderConnectorIcon` (usually == displayId; gmail → google). */
  iconId: string;
  /** Human display name (e.g. "Gmail", "GitHub", "Jira"). */
  name: string;
  /** Pre-made playful card title, non-serious / non-power-user. */
  playful: string;
  brandColor: string;
  /** Tool-name prefixes (lowercase, "_" normalized) matched with "_" boundary. */
  prefixes: string[];
}

export const CONNECTOR_METAS: ConnectorMeta[] = [
  {
    displayId: "google",
    iconId: "gmail",
    name: "Gmail",
    playful: "Fiddling with your inbox",
    brandColor: "#4285F4",
    prefixes: ["gmail", "email", "emails", "inbox"],
  },
  {
    displayId: "google",
    iconId: "googlecalendar",
    name: "Google Calendar",
    playful: "Rearranging your life",
    brandColor: "#4285F4",
    prefixes: ["googlecalendar", "google_calendar", "gcal", "calendar", "calendars"],
  },
  {
    displayId: "google",
    iconId: "googledrive",
    name: "Google Drive",
    playful: "Digging through files",
    brandColor: "#188038",
    prefixes: ["googledrive", "google_drive", "gdrive", "drive"],
  },
  {
    displayId: "google",
    iconId: "google",
    name: "Google",
    playful: "Rummaging through Google",
    brandColor: "#4285F4",
    prefixes: ["google"],
  },
  {
    displayId: "slack",
    iconId: "slack",
    name: "Slack",
    playful: "Slacking off",
    brandColor: "#4A154B",
    prefixes: ["slack"],
  },
  {
    displayId: "github",
    iconId: "github",
    name: "GitHub",
    playful: "Poking the repo",
    brandColor: "currentColor",
    prefixes: ["github"],
  },
  {
    displayId: "linear",
    iconId: "linear",
    name: "Linear",
    playful: "Organizing chaos",
    brandColor: "#5E6AD2",
    prefixes: ["linear"],
  },
  {
    displayId: "notion",
    iconId: "notion",
    name: "Notion",
    playful: "Notion-ing around",
    brandColor: "currentColor",
    prefixes: ["notion"],
  },
  {
    displayId: "trello",
    iconId: "trello",
    name: "Trello",
    playful: "Carding things",
    brandColor: "#0052CC",
    prefixes: ["trello"],
  },
  {
    displayId: "airtable",
    iconId: "airtable",
    name: "Airtable",
    playful: "Databasing casually",
    brandColor: "#FFBF00",
    prefixes: ["airtable"],
  },
  {
    displayId: "hubspot",
    iconId: "hubspot",
    name: "HubSpot",
    playful: "CRM-ing it up",
    brandColor: "#FF7A59",
    prefixes: ["hubspot"],
  },
  {
    displayId: "asana",
    iconId: "asana",
    name: "Asana",
    playful: "Asana-ing tasks",
    brandColor: "#F06A6A",
    prefixes: ["asana"],
  },
  {
    displayId: "dropbox",
    iconId: "dropbox",
    name: "Dropbox",
    playful: "Dropping files",
    brandColor: "#0061FF",
    prefixes: ["dropbox"],
  },
  {
    displayId: "atlassian",
    iconId: "atlassian",
    name: "Jira",
    playful: "Ticketing around",
    brandColor: "#0052CC",
    prefixes: ["jira", "atlassian", "confluence"],
  },
  {
    displayId: "canva",
    iconId: "canva",
    name: "Canva",
    playful: "Doodling a design",
    brandColor: "#00C4CC",
    prefixes: ["canva"],
  },
  {
    displayId: "composio",
    iconId: "composio",
    name: "Apps",
    playful: "Rooting around your apps",
    brandColor: "#888",
    prefixes: ["composio"],
  },
];

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Map a tool name (e.g. `github_create_issue`, `GMAIL_SEND_EMAIL`,
 * `composio_search_tools`) to its app meta.
 *
 * Longest-prefix-first with a strict "_" boundary so short keys never
 * mislabel unrelated tools (e.g. `clickup_*` must not match browser `click`).
 * Returns null when nothing matches — callers fall back to the generic label
 * and never show the raw id.
 */
export function getConnectorMetaForTool(toolName: unknown): ConnectorMeta | null {
  if (typeof toolName !== "string" || !toolName) return null;
  const lower = normalizeToolName(toolName);
  if (!lower) return null;
  // Flatten all (prefix → meta), longest prefix first.
  const entries: Array<{ prefix: string; meta: ConnectorMeta }> = [];
  for (const meta of CONNECTOR_METAS) {
    for (const p of meta.prefixes) entries.push({ prefix: p, meta });
  }
  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { prefix, meta } of entries) {
    if (prefix === "composio") {
      // Meta-tool family: composio_search_tools, composio_multi_execute_tool, …
      if (lower === prefix || lower.startsWith(`${prefix}_`) || lower.startsWith(prefix)) return meta;
      continue;
    }
    if (lower === prefix || lower.startsWith(`${prefix}_`)) return meta;
  }
  return null;
}

/** True for any tool call that should render the connector card UI. */
export function isConnectorToolName(toolName: unknown): boolean {
  return getConnectorMetaForTool(toolName) !== null;
}

/**
 * Infer the app(s) behind a Composio meta-tool call (`composio_search_tools`,
 * `COMPOSIO_MULTI_EXECUTE_TOOL`, …) by deep-scanning its args.
 *
 * Meta-tools hide the real action inside their payload
 * (`{ tools: [{ tool_slug: "GMAIL_SEND_EMAIL", … }] }`, `{ toolkit_slug:
 * "gmail", query: "…" }`, free-text queries mentioning an app, …), so the
 * tool name alone always resolves to the generic "Apps" meta. Scanning every
 * string in the payload for known app identifiers recovers the per-app meta,
 * letting each card show its own pre-made playful name + logo.
 *
 * Matching is token-exact on free text (so "notions" never matches "notion"
 * and "clickup" never matches anything), plus slug-prefix matching for
 * `tool_slug`-style values. Returns metas ordered by hit frequency (most
 * likely first), deduped. Returns [] when nothing app-like is found.
 */
export function inferConnectorMetasFromArgs(args: unknown): ConnectorMeta[] {
  const strings: string[] = [];
  const collect = (v: unknown, depth = 0): void => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") {
      if (v.length <= 500) strings.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v.slice(0, 50)) collect(item, depth + 1);
      return;
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).slice(0, 50);
      for (const [k, val] of entries) {
        if (k !== "label") strings.push(k);
        collect(val, depth + 1);
      }
    }
  };
  try {
    collect(args);
  } catch {
    return [];
  }
  if (strings.length === 0) return [];

  // Longest prefix first so `googlecalendar` beats `google`, `gmail` beats
  // `mail`-style loose aliases, etc.
  const entries: Array<{ prefix: string; meta: ConnectorMeta }> = [];
  for (const meta of CONNECTOR_METAS) {
    if (meta.displayId === "composio") continue;
    for (const p of meta.prefixes) entries.push({ prefix: p, meta });
  }
  entries.sort((a, b) => b.prefix.length - a.prefix.length);

  const hits = new Map<ConnectorMeta, number>();
  for (const raw of strings) {
    const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!s) continue;
    for (const { prefix, meta } of entries) {
      if (s === prefix || s.startsWith(`${prefix}_`) || s.endsWith(`_${prefix}`)) {
        hits.set(meta, (hits.get(meta) || 0) + 2);
        break;
      }
    }
    // Free-text fallback: exact token match (no substring matching).
    const tokens = new Set(s.split("_").filter(Boolean));
    if (tokens.size > 1) {
      for (const { prefix, meta } of entries) {
        if (prefix.includes("_")) continue;
        if (tokens.has(prefix)) {
          hits.set(meta, (hits.get(meta) || 0) + 1);
          break;
        }
      }
    }
  }
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([meta]) => meta);
}

/**
 * Toolkit slug (Composio `toolkit.slug`, e.g. "gmail") → parent connector
 * display id (e.g. "google"). Used to resolve the cached app logo entry.
 */
export function getDisplayIdForToolkitSlug(slug: string): string {
  const s = (slug || "").toLowerCase();
  if (s === "jira" || s === "confluence") return "atlassian";
  if (s === "gmail" || s === "googlecalendar" || s === "googledrive" || s === "google_calendar" || s === "google_drive") return "google";
  return s;
}
