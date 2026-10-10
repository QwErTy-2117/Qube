"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

export const WebFetchToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  const url = (args as any)?.url || "";
  let data: { url?: string; status?: number; content?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayUrl = data.url || url;
  const verb = friendlyToolLabel("web_fetch", args);
  const summary = displayUrl ? domainOf(displayUrl) : "";

  if (!data.content) {
    return <ToolRow verb={verb} summary={summary} status={status} />;
  }

  return (
    <ToolRow verb={verb} summary={summary} defaultOpen={false} status={status}>
      <div className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground">
        {data.content.slice(0, 2000)}
        {data.content.length > 2000 ? "\n\n... [showing the first part]" : ""}
      </div>
    </ToolRow>
  );
};
