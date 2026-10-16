"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const ReadMemoryToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
  toolName,
}) => {
  let data: {
    entries?: Array<{
      id: string;
      category: string;
      content: string;
      createdAt?: number;
      relevance?: number;
      confidence?: number;
    }>;
    saved?: boolean;
    action?: string;
    id?: string;
    error?: string;
    message?: string;
    fallback?: boolean;
    context?: string;
  } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const isSave = (toolName as string) === "save_memory" || data.saved !== undefined || data.action !== undefined;
  if (isSave) {
    const verb = friendlyToolLabel("save_memory", args);
    if (data.saved) {
      const actionNote =
        data.action === "reinforced" ? "Already knew that — reinforced."
        : data.action === "updated" ? "Updated the memory."
        : data.action === "superseded" ? "Updated (old value superseded)."
        : "Saved.";
      return <ToolRow verb={verb} summary={actionNote} status={status} />;
    }
    return <ToolRow verb={verb} summary={data.error ? `Not saved: ${data.error.slice(0, 120)}` : "Not saved."} status={status} />;
  }

  const entries = data.entries || [];
  const verb = friendlyToolLabel("read_memory", args);

  // Legacy shape: { context: "..." } from the old recall path.
  if (entries.length === 0 && data.context) {
    return (
      <ToolRow verb={verb} summary="Recalled memories" defaultOpen={false} status={status}>
        <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{data.context.slice(0, 2000)}</p>
      </ToolRow>
    );
  }

  if (entries.length === 0) {
    return <ToolRow verb={verb} summary={data.message || "No memories stored yet."} status={status} />;
  }

  return (
    <ToolRow
      verb={verb}
      summary={`${entries.length} ${entries.length === 1 ? "memory" : "memories"}${data.fallback ? " (closest available)" : ""}`}
      defaultOpen={false}
      status={status}
    >
      <div className="flex flex-col divide-y divide-border/50">
        {entries.map((e) => (
          <div
            key={e.id}
            className="py-1.5 first:pt-0 last:pb-0"
          >
            <div className="flex items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {e.category}
              </span>
              {typeof e.relevance === "number" && e.relevance < 0.7 && (
                <span className="text-[10px] text-muted-foreground/50">
                  relevance: {Math.round(e.relevance * 100)}%
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{e.content}</p>
          </div>
        ))}
      </div>
    </ToolRow>
  );
};
