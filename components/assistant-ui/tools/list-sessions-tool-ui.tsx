"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const ListSessionsToolUI: ToolCallMessagePartComponent = ({
  result,
}) => {
  let data: {
    sessions?: Array<{
      id: string;
      title: string;
      createdAt: number;
      updatedAt: number;
    }>;
  } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {data.sessions && data.sessions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {data.sessions.map((s, i) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-md bg-background px-3 py-2"
            >
              <span className="truncate text-xs font-medium">
                {s.title || "Untitled"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground/60">
                {new Date(s.updatedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No sessions found.</p>
      )}
    </div>
  );
};
