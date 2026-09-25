"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { GlobeIcon } from "lucide-react";

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
}) => {
  const url = (args as any)?.url || "";
  let data: { url?: string; status?: number; content?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayUrl = data.url || url;
  const failed = data.status !== undefined && data.status >= 400;

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {displayUrl && (
        <div className="mb-2 flex items-center gap-2">
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className="truncate text-xs text-muted-foreground"
            title={displayUrl}
          >
            {domainOf(displayUrl)}
          </span>
        </div>
      )}
      {failed && (
        <p className="mb-2 text-xs text-red-500/90">
          Couldn&apos;t open that page.
        </p>
      )}
      {data.content && (
        <div className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2">
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
            {data.content.slice(0, 2000)}
            {data.content.length > 2000
              ? "\n\n... [showing the first part]"
              : ""}
          </pre>
        </div>
      )}
    </div>
  );
};
