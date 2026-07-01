"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { DiffView } from "./diff-view";

export const EditFileToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const path = (args as any)?.path || "";
  const oldString = (args as any)?.oldString || "";
  const newString = (args as any)?.newString || "";
  let data: { path?: string; status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  const displayPath = data.path || path;

  return (
    <div className="bg-muted/30 px-3 py-2 text-sm">
      {displayPath && (
        <div className="mb-2 font-mono text-xs text-muted-foreground">
          {displayPath}
        </div>
      )}
      {data.status === "edited" ? (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Successfully edited
        </div>
      ) : data.status === "failed" ? (
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <span className="size-1.5 rounded-full bg-red-500" />
          Edit failed
        </div>
      ) : null}
      {oldString && newString && (
        <div className="mt-2">
          <DiffView oldContent={oldString} newContent={newString} />
        </div>
      )}
    </div>
  );
};
