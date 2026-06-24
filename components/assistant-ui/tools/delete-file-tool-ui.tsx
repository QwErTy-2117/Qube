"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Trash2Icon } from "lucide-react";

export const DeleteFileToolUI: ToolCallMessagePartComponent = ({
  argsText,
  result,
}) => {
  let data: { path?: string; status?: string } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/20">
      <div className="mb-2 flex items-center gap-2 font-medium text-red-600 dark:text-red-400">
        <Trash2Icon className="size-4" />
        <span>Delete File</span>
      </div>
      {data.path && (
        <div className="mb-2 font-mono text-xs text-red-600/80 dark:text-red-400/80">
          {data.path}
        </div>
      )}
      {data.status === "deleted" && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <span className="size-1.5 rounded-full bg-red-500" />
          File deleted
        </div>
      )}
    </div>
  );
};
