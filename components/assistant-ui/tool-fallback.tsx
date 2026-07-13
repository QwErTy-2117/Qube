"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { Loader2Icon } from "lucide-react";

const CONNECTOR_TOOL_PREFIXES: Record<string, { id: string; name: string }> = {
  linear: { id: "linear", name: "Linear" },
  jira: { id: "atlassian", name: "Jira" },
  trello: { id: "trello", name: "Trello" },
  airtable: { id: "airtable", name: "Airtable" },
  notion: { id: "notion", name: "Notion" },
  slack: { id: "slack", name: "Slack" },
  github: { id: "github", name: "GitHub" },
  gmail: { id: "google", name: "Gmail" },
  googlecalendar: { id: "google", name: "Google Calendar" },
  googledrive: { id: "google", name: "Google Drive" },
  hubspot: { id: "hubspot", name: "HubSpot" },
  asana: { id: "asana", name: "Asana" },
  dropbox: { id: "dropbox", name: "Dropbox" },
  composio: { id: "composio", name: "Search" },
};

function getConnectorMeta(toolName: string): { id: string; name: string } | null {
  const lower = toolName.toLowerCase();
  if (lower === "composio_search_tools") return { id: "search", name: "Connected apps" };
  for (const [prefix, meta] of Object.entries(CONNECTOR_TOOL_PREFIXES)) {
    if (lower.startsWith(prefix)) return meta;
  }
  return null;
}

function getConnectorColor(id: string): string {
  const colors: Record<string, string> = {
    linear: "#5E6AD2", atlassian: "#0052CC", trello: "#0052CC",
    airtable: "#FFBF00", notion: "currentColor", slack: "#4A154B",
    github: "currentColor", google: "#4285F4", hubspot: "#FF7A59",
    asana: "#F06A6A", dropbox: "#0061FF",
  };
  return colors[id] || "#888";
}

export const ToolFallback: ToolCallMessagePartComponent = ({ toolName, result, status }) => {
  const meta = getConnectorMeta(toolName);
  const isRunning = status?.type === "running";

  if (meta) {
    const icon = renderConnectorIcon(meta.id, 18);
    return (
      <div className="rounded-xl border border-border/60 bg-background p-3 text-sm flex items-center gap-3">
        {icon && (
          <div
            className="size-5 flex items-center justify-center shrink-0"
            style={{ color: getConnectorColor(meta.id) }}
          >
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-foreground/90">{meta.name}</div>
          <div className="text-[11px] text-muted-foreground/60">
            {isRunning ? "Working..." : "Done"}
          </div>
        </div>
        {isRunning && (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground/40 shrink-0" />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
      <div className="font-medium">{toolName}</div>
      {result ? <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
};
