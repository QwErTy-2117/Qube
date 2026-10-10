"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const ReadMemoryToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
}) => {
  let data: {
    entries?: Array<{
      id: string;
      category: string;
      content: string;
      createdAt: number;
      relevance: number;
    }>;
  } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const entries = data.entries || [];
  const verb = friendlyToolLabel("read_memory", args);

  if (entries.length === 0) {
    return <ToolRow verb={verb} summary="No memories stored yet." status={status} />;
  }

  return (
    <ToolRow
      verb={verb}
      summary={`${entries.length} ${entries.length === 1 ? "memory" : "memories"}`}
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
              {e.relevance < 0.7 && (
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
