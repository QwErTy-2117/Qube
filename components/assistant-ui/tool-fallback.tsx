"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ConnectorToolUI } from "@/components/assistant-ui/tools/connector-tool-ui";
import { friendlyToolLabel } from "@/components/assistant-ui/tools/tool-labels";
import { isConnectorToolName } from "@/lib/connectors/connector-meta";
import { ToolRow } from "@/components/assistant-ui/tools/tool-row";

function isConnectorTool(toolName: string): boolean {
  return isConnectorToolName(toolName);
}

// Names stay friendly and non-technical (shared labels); raw tool ids
// like "mcp_tool_call" never reach the UI.
function titleFor(toolName: string, args: unknown): string {
  return friendlyToolLabel(toolName, args);
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const pick = (v: unknown, max = 60): string =>
    typeof v === "string" ? v.slice(0, max) : "";
  return (
    pick(a.url) ||
    pick(a.query && `"${a.query}"`) ||
    pick(a.path) ||
    pick(a.command) ||
    pick(a.text) ||
    pick(a.name) ||
    pick(a.description) ||
    ""
  );
}

export const ToolFallback: ToolCallMessagePartComponent = (props) => {
  if (isConnectorTool(props.toolName)) {
    return <ConnectorToolUI {...props} />;
  }

  const running = (props.status as { type?: string })?.type === "running";
  const detail = summarizeArgs(props.args);
  const hasResult = props.result !== undefined && props.result !== null;
  const verb = titleFor(props.toolName, props.args);

  if (!hasResult) {
    return <ToolRow verb={verb} summary={detail || (running ? "…" : "")} status={props.status as { type?: string } | undefined} />;
  }

  const resultText =
    typeof props.result === "string"
      ? props.result.slice(0, 2000)
      : JSON.stringify(props.result, null, 2).slice(0, 2000);

  return (
    <ToolRow verb={verb} summary={detail} defaultOpen={false} status={props.status as { type?: string } | undefined}>
      <div className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground">
        {resultText}
      </div>
    </ToolRow>
  );
};
