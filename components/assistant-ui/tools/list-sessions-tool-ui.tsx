"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const ListSessionsToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
  status,
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

  const sessions = data.sessions || [];
  const verb = friendlyToolLabel("list_sessions", args);

  if (sessions.length === 0) {
    return <ToolRow verb={verb} summary="No chats yet." status={status} />;
  }

  // Compressed by default — tap to expand the chat list.
  return (
    <ToolRow
      verb={verb}
      summary={`${sessions.length} chat${sessions.length === 1 ? "" : "s"}`}
      defaultOpen={false}
      status={status}
    >
      <div className="flex max-h-48 flex-col divide-y divide-border/50 overflow-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-2 py-1.5"
          >
            <span className="truncate text-xs font-medium">
              {s.title || "Untitled"}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground/60">
              {new Date(s.updatedAt).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </ToolRow>
  );
};
