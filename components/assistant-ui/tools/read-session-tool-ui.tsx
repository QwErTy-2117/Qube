"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolRow } from "./tool-row";
import { friendlyToolLabel } from "./tool-labels";

export const ReadSessionToolUI: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  status,
}) => {
  let data: {
    session?: {
      id?: string;
      title?: string;
      summary?: string;
      transcript?: string;
      createdAt?: number;
    };
  } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const session = data.session;
  const verb = friendlyToolLabel(toolName || "read_session", args);

  if (!session) {
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
        {session.transcript && (
          <div className="max-h-48 overflow-auto">
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
              {session.transcript.slice(0, 3000)}
              {session.transcript.length > 3000
                ? "\n\n... [truncated]"
                : ""}
            </pre>
          </div>
        )}
        {session.createdAt && (
          <div className="text-[11px] text-muted-foreground/60">
            {new Date(session.createdAt).toLocaleString()}
          </div>
        )}
        {session.id?.startsWith("session_") && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Session not found
          </p>
        )}
      </div>
    </ToolRow>
  );
};
