"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { BrainIcon } from "lucide-react";

export const ReadMemoryToolUI: ToolCallMessagePartComponent = ({
  result,
}) => {
  let data: {
    entries?: Array<{
      id: string;
      category: string;
      content: string;
      createdAt: number;
      confidence: number;
    }>;
  } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <BrainIcon className="size-4" />
        <span>Stored Memories</span>
      </div>
      {data.entries && data.entries.length > 0 ? (
        <div className="flex flex-col gap-2">
          {data.entries.map((e) => (
            <div
              key={e.id}
              className="rounded-md bg-background px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  {e.category}
                </span>
                {e.confidence < 0.7 && (
                  <span className="text-[10px] text-muted-foreground/50">
                    confidence: {Math.round(e.confidence * 100)}%
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{e.content}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No memories stored yet.</p>
      )}
    </div>
  );
};
