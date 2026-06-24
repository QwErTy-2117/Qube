"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ScrollTextIcon } from "lucide-react";

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
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <ScrollTextIcon className="size-4" />
        <span>Session Summary</span>
      </div>
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
