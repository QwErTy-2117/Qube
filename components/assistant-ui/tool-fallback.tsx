"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { WrenchIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ConnectorToolUI } from "@/components/assistant-ui/tools/connector-tool-ui";
import { friendlyToolLabel } from "@/components/assistant-ui/tools/tool-labels";

const CONNECTOR_PREFIXES = [
  "linear", "jira", "trello", "airtable", "notion", "slack",
  "github", "gmail", "googlecalendar", "googledrive",
  "hubspot", "asana", "dropbox",
];

function isConnectorTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return CONNECTOR_PREFIXES.some(p => lower.startsWith(p));
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

  const [open, setOpen] = useState(false);
  const running = (props.status as { type?: string })?.type === "running";
  const detail = summarizeArgs(props.args);
  const hasResult = props.result !== undefined && props.result !== null;

  return (
    <div className="rounded-xl bg-muted/30 px-3 py-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
          <WrenchIcon className="size-3.5 text-muted-foreground" />
        </span>
        <span className="font-medium text-foreground/90">{titleFor(props.toolName, props.args)}</span>
        {detail ? (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{detail}</span>
        ) : (
          <span className="flex-1" />
        )}
        {running ? (
          <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">working…</span>
        ) : hasResult ? (
          <ChevronDownIcon
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        ) : null}
      </button>
      {open && hasResult && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          {typeof props.result === "string" ? props.result.slice(0, 2000) : JSON.stringify(props.result, null, 2).slice(0, 2000)}
        </pre>
      )}
    </div>
  );
};
