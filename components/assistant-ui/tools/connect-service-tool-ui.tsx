"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

const CONNECTOR_NAMES: Record<string, string> = {
  linear: "Linear", atlassian: "Jira", trello: "Trello",
  airtable: "Airtable", notion: "Notion", slack: "Slack",
  github: "GitHub", google: "Google", hubspot: "HubSpot",
  asana: "Asana", dropbox: "Dropbox", canva: "Canva",
};

const CONNECTOR_COLORS: Record<string, string> = {
  linear: "#5E6AD2", atlassian: "#0052CC", trello: "#0052CC",
  airtable: "#FFBF00", notion: "currentColor", slack: "#4A154B",
  github: "currentColor", google: "#4285F4", hubspot: "#FF7A59",
  asana: "#F06A6A", dropbox: "#0061FF", canva: "#7D2AE8",
};

export const ConnectServiceToolUI: ToolCallMessagePartComponent = ({ args: rawArgs, result, status }) => {
  const args = (rawArgs || {}) as any;
  const connectorId = args.connectorId || "";
  const isRunning = status?.type === "running";

  const parsed = (() => {
    try { return typeof result === "string" ? JSON.parse(result) : result; } catch { return {}; }
  })();

  const connectUrl: string | undefined = parsed?.connectUrl;
  const error: string | undefined = parsed?.error;
  const name = CONNECTOR_NAMES[connectorId] || connectorId;
  const color = CONNECTOR_COLORS[connectorId] || "#888";
  const icon = renderConnectorIcon(connectorId, 18);

  return (
    <div className="rounded-xl border border-border/60 bg-background p-2.5 text-sm">
      <div className="flex items-center gap-2">
        {icon && (
          <div className="size-6 flex items-center justify-center shrink-0 rounded-md bg-muted/40" style={{ color }}>
            {icon}
          </div>
        )}
        <span className="text-xs font-medium text-foreground/80" style={{ color }}>
          {name}
        </span>
        {isRunning && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground/40 shrink-0 ml-auto" />}
      </div>

      {connectUrl && (
        <Button asChild size="sm" className="w-full rounded-full h-7 text-[11px] mt-2 font-medium"
          style={{ backgroundColor: color === "currentColor" ? undefined : color, color: "#fff" }}>
          <a href={connectUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon className="size-3 mr-1.5" /> Connect
          </a>
        </Button>
      )}

      {error && (
        <p className="text-[11px] text-destructive/80 mt-1">{error}</p>
      )}
    </div>
  );
};
