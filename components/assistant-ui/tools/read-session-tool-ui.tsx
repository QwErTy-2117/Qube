"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const ReadSessionToolUI: ToolCallMessagePartComponent = ({
  result,
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

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {session ? (
        <div className="flex flex-col gap-2">
          {session.title && (
            <div className="text-xs font-medium">{session.title}</div>
          )}
          {session.summary && (
            <div className="rounded-md bg-background p-2 text-xs text-muted-foreground">
              {session.summary}
            </div>
          )}
          {session.transcript && (
            <div className="max-h-48 overflow-auto rounded-md bg-background p-2">
              <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                {session.transcript.slice(0, 3000)}
                {session.transcript.length > 3000
                  ? "\n\n... [truncated]"
                  : ""}
              </pre>
            </div>
          )}
          {session.createdAt && (
            <div className="text-xs text-muted-foreground/60">
              {new Date(session.createdAt).toLocaleString()}
            </div>
          )}
          {session.id?.startsWith("session_") && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Session not found
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Session not found.</p>
      )}
    </div>
  );
};
