"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileEditIcon } from "lucide-react";
import { DiffView } from "./diff-view";

export const EditFileToolUI: ToolCallMessagePartComponent = ({
  argsText,
  result,
}) => {
  let args: { path?: string; oldString?: string; newString?: string } = {};
  let data: { path?: string; status?: string } = {};
  try {
    args = JSON.parse(argsText || "{}");
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <FileEditIcon className="size-4" />
        <span>Edit File</span>
      </div>
      {(data.path || args.path) && (
        <div className="mb-2 font-mono text-xs text-muted-foreground">
          {data.path || args.path}
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
      {args.oldString && args.newString && (
        <div className="mt-2">
          <DiffView oldContent={args.oldString} newContent={args.newString} />
        </div>
      )}
    </div>
  );
};
