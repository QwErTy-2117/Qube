"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const ReadSessionSummaryToolUI: ToolCallMessagePartComponent = ({
  result,
}) => {
  let data: { session?: { title?: string; summary?: string; updatedAt?: number } } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const session = data.session;

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {session && !("error" in (session as any)) ? (
        <div className="flex flex-col gap-2">
          {session.title && (
            <div className="text-xs font-medium">{session.title}</div>
          )}
          {session.summary && (
            <div className="rounded-md bg-background p-2 text-xs text-muted-foreground">
              {session.summary}
            </div>
          )}
          {session.updatedAt && (
            <div className="text-xs text-muted-foreground/60">
              {new Date(session.updatedAt).toLocaleString()}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Session not found.</p>
      )}
    </div>
  );
};
