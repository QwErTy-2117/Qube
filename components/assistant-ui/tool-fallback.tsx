"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ConnectorToolUI } from "@/components/assistant-ui/tools/connector-tool-ui";

const CONNECTOR_PREFIXES = [
  "linear", "jira", "trello", "airtable", "notion", "slack",
  "github", "gmail", "googlecalendar", "googledrive",
  "hubspot", "asana", "dropbox",
];

function isConnectorTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return CONNECTOR_PREFIXES.some(p => lower.startsWith(p));
}

export const ToolFallback: ToolCallMessagePartComponent = (props) => {
  if (isConnectorTool(props.toolName)) {
    return <ConnectorToolUI {...props} />;
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
      <div className="font-medium">{props.toolName}</div>
      {props.result ? (
        <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(props.result, null, 2)}</pre>
      ) : null}
    </div>
  );
};
