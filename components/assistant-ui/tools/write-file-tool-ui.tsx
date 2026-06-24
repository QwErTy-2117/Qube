"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileEditIcon } from "lucide-react";
import { DiffView } from "./diff-view";

export const WriteFileToolUI: ToolCallMessagePartComponent = ({
  argsText,
  result,
}) => {
  let data: { path?: string; status?: string } = {};
  let prevContent = "";
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <FileEditIcon className="size-4" />
        <span>{data.status === "written" ? "File Written" : "Write File"}</span>
      </div>
      {data.path && (
        <div className="mb-2 font-mono text-xs text-muted-foreground">
          {data.path}
        </div>
      )}
      {data.status === "written" && (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Successfully written
        </div>
      )}
    </div>
  );
};
