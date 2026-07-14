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
  const icon = renderConnectorIcon(connectorId, 20);

  return (
    <div className="rounded-xl border border-border/60 bg-background p-4 text-sm max-w-sm">
      <div className="flex items-center gap-3 mb-3">
        <div className="size-8 flex items-center justify-center rounded-lg shrink-0" style={{ color }}>
          {icon || <span className="text-base font-bold">{name[0]}</span>}
        </div>
        <div>
          <p className="font-semibold text-foreground">{name}</p>
          <p className="text-xs text-muted-foreground">
            {isRunning ? "Generating link…" : connectUrl ? "Click to authorise" : error ? "Setup required" : ""}
          </p>
        </div>
        {isRunning && <Loader2Icon className="size-4 animate-spin text-muted-foreground/40 ml-auto shrink-0" />}
      </div>

      {connectUrl && (
        <Button
          asChild
          size="sm"
          className="w-full rounded-full h-8 text-xs font-semibold"
          style={{ backgroundColor: color === "currentColor" ? undefined : color, color: "#fff" }}
        >
          <a href={connectUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon className="size-3 mr-1.5" />
            Connect {name}
          </a>
        </Button>
      )}

      {error && (
        <p className="text-xs text-destructive/80 mt-1">{error}</p>
      )}
    </div>
  );
};
