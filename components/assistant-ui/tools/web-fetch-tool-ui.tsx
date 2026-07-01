"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

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

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {displayUrl && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">URL:</span>
          <span className="truncate font-mono text-xs text-blue-600 dark:text-blue-400">
            {displayUrl}
          </span>
        </div>
      )}
      {data.status !== undefined && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status:</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              data.status < 400
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            }`}
          >
            {data.status}
          </span>
        </div>
      )}
      {data.content && (
        <div className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2">
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
            {data.content.slice(0, 2000)}
            {data.content.length > 2000
              ? "\n\n... [content truncated in preview]"
              : ""}
          </pre>
        </div>
      )}
    </div>
  );
};
