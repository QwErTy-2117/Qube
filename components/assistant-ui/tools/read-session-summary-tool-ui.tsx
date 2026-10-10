"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const ReadSessionSummaryToolUI: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  status,
}) => {
  let data: { session?: { title?: string; summary?: string; updatedAt?: number } } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const session = data.session;
  const verb = friendlyToolLabel(toolName || "read_session_summary", args);

  if (!session || ("error" in (session as any))) {
    return <ToolRow verb={verb} summary="Not found." status={status} />;
  }

  // Compressed by default — tap to expand the past chat.
  return (
    <ToolRow
      verb={verb}
      summary={session.title || ""}
      defaultOpen={false}
      status={status}
    >
      <div className="flex flex-col gap-2">
        {session.summary && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {session.summary}
          </p>
        )}
        {session.updatedAt && (
          <div className="text-[11px] text-muted-foreground/60">
            {new Date(session.updatedAt).toLocaleString()}
          </div>
        )}
      </div>
    </ToolRow>
  );
};
