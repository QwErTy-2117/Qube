"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const BrowserNavigateToolUI: ToolCallMessagePartComponent = ({ args, result }) => {
  const url = (args as any)?.url || "";
  let data: { url?: string; title?: string; snapshot?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {data.url && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">URL:</span>
          <span className="truncate font-mono text-xs text-blue-600 dark:text-blue-400">
            {data.url}
          </span>
        </div>
      )}
      {data.title && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Title:</span>
          <span className="text-xs font-medium">{data.title}</span>
        </div>
      )}
      {data.snapshot && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Accessibility Snapshot
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            {data.snapshot}
          </pre>
        </details>
      )}
    </div>
  );
};

export const BrowserScreenshotToolUI: ToolCallMessagePartComponent = ({ result }) => {
  let data: { dataUri?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {data.dataUri ? (
        <img
          src={data.dataUri}
          alt="Browser screenshot"
          className="w-full rounded-md border"
        />
      ) : (
        <span className="text-xs text-muted-foreground">Screenshot captured</span>
      )}
    </div>
  );
};

export const BrowserToolUI: ToolCallMessagePartComponent = ({ args, result }) => {
  const toolName = (args as any)?.label || "browser";
  let data: Record<string, unknown> = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as Record<string, unknown>;
  } catch {}

  const snapshot = typeof data.snapshot === "string" ? data.snapshot : undefined;

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Tool:</span>
        <span className="font-mono text-xs font-medium">{toolName}</span>
      </div>
      {snapshot && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Accessibility Snapshot
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            {snapshot}
          </pre>
        </details>
      )}
    </div>
  );
};
