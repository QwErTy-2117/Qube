"use client";

import { useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { composioLogoUrlForIconId, composioLogoDarkClass } from "@/lib/connectors/composio-logo";
import { ToolRow } from "@/components/assistant-ui/tools/tool-row";
import { ExternalLinkIcon } from "lucide-react";
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
  const running = (status as { type?: string })?.type === "running";
  const [logoFailed, setLogoFailed] = useState(false);

  const parsed = (() => {
    try { return typeof result === "string" ? JSON.parse(result) : result; } catch { return {}; }
  })();

  const connectUrl: string | undefined = parsed?.connectUrl;
  const error: string | undefined = parsed?.error;
  const name = CONNECTOR_NAMES[connectorId] || connectorId;
  const color = CONNECTOR_COLORS[connectorId] || "#888";
  // Live Composio logo CDN artwork first (most up-to-date vendor mark),
  // static brand glyph as offline/error fallback only.
  const composioLogo = !logoFailed ? composioLogoUrlForIconId(connectorId) : null;
  const icon = renderConnectorIcon(connectorId, 14);
  const hasAction = Boolean(connectUrl || error);

  return (
    <ToolRow
      verb={
        <span className="flex min-w-0 items-center gap-2">
          {composioLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={composioLogo} alt="" className={`size-4 shrink-0 object-contain${composioLogoDarkClass(connectorId)}`} loading="lazy" onError={() => setLogoFailed(true)} />
          ) : (
            icon && (
              <span className="flex shrink-0 items-center justify-center" style={{ color }}>
                {icon}
              </span>
            )
          )}
          <span className="truncate" style={{ color: color === "currentColor" ? undefined : color }}>
            {name}
          </span>
        </span>
      }
      summary={running ? "…" : connectUrl ? "Tap to connect" : ""}
      status={status}
      open={hasAction ? true : undefined}
      onOpenChange={() => {}}
    >
      {connectUrl ? (
        <Button asChild size="sm" className="w-full rounded-full h-7 text-[11px] font-medium"
          style={{ backgroundColor: color === "currentColor" ? undefined : color, color: "#fff" }}>
          <a href={connectUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon className="size-3 mr-1.5" /> Connect
          </a>
        </Button>
      ) : null}
      {error ? (
        <p className="text-[11px] text-destructive/80">{error}</p>
      ) : null}
    </ToolRow>
  );
};
